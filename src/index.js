import express from "express";
import { ApolloServer, gql } from "apollo-server-express";
import { createServer } from "http";
// Elasticsearch client 생성
import { Client } from "@elastic/elasticsearch";

//Socket.io
import { Server as SocketIOServer } from "socket.io";

const client = new Client({
  node: "http://localhost:9202",
});

// 스키마 정의 - GraphQL 명세에서 사용될 데이터, 요청의 타입 지정 (모든 값 한 번에 가져오기..?)
const typeDefs = gql`
  type Metricbeat {
    cpu_user: Float
    cpu_sys: Float
    cpu_core: Float
    memory_gauge: Float
    load_5m: Float
    swap: Float
    fsstat_used: Float
    fsstat_total: Float
    process: Float
    in_pocketloss: Float
    out_pocketloss: Float
    used_memory: Float
    total_memory: Float
    disk_usage: Float
  }
  type Query {
    metricbeat: [Metricbeat]
  }
`;

// 리졸버 정의 - 서비스의 액션들을 함수로 지정, 요청에 따라 데이터를 반환, 입력, 수정, 삭제
const resolvers = {
  Query: {
    metricbeat: async () => {
      const { body } = await client.search({
        index: "metricbeat",
        body: {
          query: {
            bool: {
              filter: [
                {
                  range: {
                    "@timestamp": {
                      gte: "now-15m",
                    },
                  },
                },
              ],
            },
          },
          aggs: {
            CPU_gauge_user: {
              avg: {
                field: "system.cpu.user.pct",
              },
            },
            CPU_gauge_sys: {
              avg: {
                field: "system.cpu.system.pct",
              },
            },
            CPU_gauge_core: {
              avg: {
                field: "system.cpu.cores",
              },
            },
            Memory_gauge: {
              avg: {
                field: "system.memory.actual.used.pct",
              },
            },
            Load_5m: {
              avg: {
                field: "system.load.5",
              },
            },
            Swap_usage: {
              avg: {
                field: "system.memory.swap.used.pct",
              },
            },
            Fsstat_used: {
              avg: {
                field: "system.fsstat.total_size.used",
              },
            },
            Fsstat_total: {
              avg: {
                field: "system.fsstat.total_size.total",
              },
            },
            Process: {
              cardinality: {
                field: "process.pid",
              },
            },
            In_pocketloss: {
              max: {
                field: "system.network.in.dropped",
              },
            },
            Out_pocketloss: {
              max: {
                field: "system.network.out.dropped",
              },
            },
            Used_memory: {
              avg: {
                field: "system.memory.actual.used.bytes",
              },
            },
            Total_memory: {
              avg: {
                field: "system.memory.total",
              },
            },
            Top_disk: {
              terms: {
                field: "system.filesystem.mount_point.keyword",
                size: 1,
                order: {
                  used_pct: "desc",
                },
              },
              aggs: {
                used_pct: {
                  avg: {
                    field: "system.filesystem.used.pct",
                  },
                },
              },
            },
          },
        },
      });

      console.log(body.aggregations);

      const result = [];
      const topDisk = body.aggregations.Top_disk.buckets[0];
      result[0] = [topDisk.key, (topDisk.used_pct.value * 100).toFixed(2)];

      console.log(result);

      return [
        {
          cpu_user: body.aggregations.CPU_gauge_user.value,
          cpu_sys: body.aggregations.CPU_gauge_sys.value,
          cpu_core: body.aggregations.CPU_gauge_core.value,
          memory_gauge: body.aggregations.Memory_gauge.value,
          load_5m: body.aggregations.Load_5m.value,
          swap: body.aggregations.Swap_usage.value,
          fsstat_used: body.aggregations.Fsstat_used.value,
          fsstat_total: body.aggregations.Fsstat_total.value,
          process: body.aggregations.Process.value,
          in_pocketloss: body.aggregations.In_pocketloss.value,
          out_pocketloss: body.aggregations.Out_pocketloss.value,
          used_memory: body.aggregations.Used_memory.value,
          total_memory: body.aggregations.Total_memory.value,
          disk_usage: result[0],
        },
      ];
    },
  },
};

const app = express();
const port = 4000;

const httpServer = createServer(app);
// Apollo 서버 인스턴스 생성
const server = new ApolloServer({ typeDefs, resolvers }); // typeDef와 resolver를 인자로 받아 서버 생성

await server.start();
server.applyMiddleware({ app });

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 서버 실행

io.on("connection", (socket) => {
  console.log("New client connected");

  const sendMetricbeatData = async () => {
    const [metricbeatData] = await resolvers.Query.metricbeat();

    //데이터 형태에 맞게 정제
    const cpuGaugeData = (
      ((metricbeatData.cpu_user + metricbeatData.cpu_sys) /
        metricbeatData.cpu_core) *
      100
    ).toFixed(3);
    const MemoryGauge = (metricbeatData.memory_gauge * 100).toFixed(3);
    const LoadGauge = metricbeatData.load_5m.toFixed(3);
    const SwapUsage = (metricbeatData.swap * 100).toFixed(3);
    const DiskUsed = (
      (metricbeatData.fsstat_used / metricbeatData.fsstat_total) *
      100
    ).toFixed(3);
    const ProcessNum = metricbeatData.process;
    const InPocketloss = metricbeatData.in_pocketloss;
    const OutPocketloss = metricbeatData.out_pocketloss;
    const UsedMemory = (metricbeatData.used_memory / 1073741824).toFixed(1);
    const TotalMemory = metricbeatData.total_memory / 1073741824;
    const DiskUsage = metricbeatData.disk_usage;

    const mbData = [
      cpuGaugeData,
      MemoryGauge,
      LoadGauge,
      SwapUsage,
      DiskUsed,
      ProcessNum,
      InPocketloss,
      OutPocketloss,
      UsedMemory,
      TotalMemory,
      DiskUsage,
    ];

    socket.emit("MetricbeatData", mbData);
    //console.log(mbData);
  };

  sendMetricbeatData();

  // 데이터 전송 간격 설정
  const intervalId = setInterval(() => {
    sendMetricbeatData();
  }, 10000);

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    clearInterval(intervalId);
  });
});

httpServer.listen(port, () => {
  console.log(
    `🚀  Server ready at http://localhost:${port}}${server.graphqlPath}`
  );
  console.log(`🚀  Socket.io server running on http://localhost:${port}`);
});
