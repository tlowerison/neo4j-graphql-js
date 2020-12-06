import { GraphQLRequestContextWillSendResponse } from 'apollo-server-plugin-base';

export const Neo4jPlugin = {
  willSendResponse(requestContext) {
    return requestContext.context.closeNeo4jSession();
  }
};
