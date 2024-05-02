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
    date: String
    agent: Agent
  }
  type Agent {
    hostname: String
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
        index: "test_index",
        body: {
          query: {
            match_all: {},
          },
        },
      });
      console.log(
        body.hits.hits.map((hit) => ({
          date: hit._source.date,
          agent: {
            hostname: hit._source.agent.hostname,
          },
        }))
      );

      return body.hits.hits.map((hit) => ({
        date: hit._source.date,
        agent: {
          hostname: hit._source.agent.hostname,
        },
      }));
    },
    //hello: () => "Hello world!",
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
    const metricbeatData = await resolvers.Query.metricbeat();
    socket.emit("metricbeatData", metricbeatData);
  };

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
