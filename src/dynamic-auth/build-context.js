export const authorizations = {};

export const buildContext = driver => async ({ req }) => {
  const driverSession = driver.session();
  return {
    authorizations,
    driver,
    driverSession,
    req,
    cypherParams: req.session?.me ? { me: req.session.me } : {},
    session: req.session,
    tx: driverSession.beginTransaction()
  };
};
