export const Neo4jPlugin = {
  willSendResponse(requestContext) {
    return requestContext.context.closeNeo4jSession();
  }
};
