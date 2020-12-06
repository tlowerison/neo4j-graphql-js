export const authorizations = {};
export const environments = {};

export const buildContext = driver => async ({ req }) => {
  let neo4jSession;
  let tx;
  const getNeo4jSession = () =>
    neo4jSession ? neo4jSession : (neo4jSession = driver.session());
  return {
    authorizations,
    environments,
    driver,
    getNeo4jSession,
    req,
    closeNeo4jSession: () => neo4jSession && neo4jSession.close(),
    cypherParams: req.session?.me ? { me: req.session.me } : {},
    getTx: () => (tx ? tx : getNeo4jSession().beginTransaction()),
    session: req.session
  };
};
