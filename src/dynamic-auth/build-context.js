import { verifyAndDecodeToken } from './verify-and-decode-token';

export const authorizations = {};
export const environments = {};

export const buildContext = (driver, getMe) => async ({ req }) => {
  const session = req.session || verifyAndDecodeToken(req);
  const me = session ? getMe(session) : null;
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
    cypherParams: me ? { me } : {},
    getTx: () => (tx ? tx : getNeo4jSession().beginTransaction()),
    session
  };
};
