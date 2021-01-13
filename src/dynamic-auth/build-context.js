import { fromPairs, has, identity } from 'ramda';
import { verifyAndDecodeToken } from './verify-and-decode-token';

export const authorizations = {};
export const environments = {};
const nullMatchMe = 'WITH NULL AS me ';

export const buildContext = (driver, config) => {
  let {
    credentials: {
      extract: extractCredentials = identity,
      keys: credentialKeys = ['_id']
    } = {},
    userType = 'User'
  } = config || {};
  let matchMe = nullMatchMe;
  if (config) {
    if (
      !Array.isArray(credentialKeys) ||
      !credentialKeys.every(credentialKey => typeof credentialKey === 'string')
    ) {
      throw new Error(
        'neo4j-graphql-js-dynamic-auth credential.keys must only include strings'
      );
    } else if (typeof extractCredentials !== 'function') {
      throw new Error(
        'neo4j-graphql-js-dynamic-auth credentials.extract must be a function'
      );
    } else if (typeof userType !== 'string') {
      throw new Error(
        'neo4j-graphql-js-dynamic-auth userType must be a string'
      );
    }
    const shouldMatchById = credentialKeys.includes('_id');
    matchMe = `MATCH (me:${userType} { ${credentialKeys
      .filter(credentialKey => credentialKey !== '_id')
      .map(
        credentialKey =>
          `${credentialKey}: $cypherParams._credentials.${credentialKey}`
      )} }) ${
      shouldMatchById ? `WHERE id(me) = $cypherParams._credentials._id ` : ''
    }`;
  }
  return async ({ req }) => {
    let credentials =
      matchMe !== nullMatchMe &&
      extractCredentials(req.session || verifyAndDecodeToken(req));
    if (typeof credentials !== 'object') {
      credentials = null;
    }
    let neo4jSession;
    let tx;
    const getNeo4jSession = () =>
      neo4jSession ? neo4jSession : (neo4jSession = driver.session());
    const getTx = () => (tx ? tx : getNeo4jSession().beginTransaction());
    const cypherParams = { _credentials: credentials || {} };
    return {
      authorizations,
      cypherParams,
      driver,
      environments,
      getNeo4jSession,
      getTx,
      req,
      closeNeo4jSession: () => neo4jSession && neo4jSession.close(),
      getMe: async () => {
        const tx = await getTx();
        const result = await tx.run(matchMe, { cypherParams });
        return (
          (result.records.length === 1 && result.records[0].get('me')) || null
        );
      },
      query: async (req, params, columns) => {
        const tx = await getTx();
        const result = await tx.run(req, params);
        if (!columns) {
          return result;
        }
        return result.records.map(record =>
          fromPairs(columns.map(column => [column, record.get(column)]))
        );
      },
      matchMe:
        credentials &&
        credentialKeys.every(credentialKey => has(credentialKey, credentials))
          ? matchMe
          : nullMatchMe,
      session: req.session
    };
  };
};
