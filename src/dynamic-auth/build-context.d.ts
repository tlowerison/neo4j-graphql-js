import { Driver, QueryResult, Session, Transaction } from 'neo4j-driver';

type Credentials = { [index: string]: any; roles: string[]; scopes: string[] };

export interface ContextConfig {
  credentials: {
    /**
     * A function for constructing the cypherParams object from an incoming JWT object
     * - defaults to (jwt) => jwt
     */
    extract?: (jwt: object) => Credentials
    /**
     * The set of keys expected to be included in the JWT which will identify the current user.
     * - defaults to ['_id']
     * - if '_id' is included it will perform use the special cypher id matching pattern
     *   - e.g. `MATCH (me) WHERE id(me) = $cypherParams._credentials._id ...`
     * - all other keys will be matchedin the standard cypher object pattern
     *   - e.g. for keys: ['uuid'], `MATCH (me { uuid: $cypherParams._credentials.uuid }) ...`
     */
    keys?: string[];
  };
  /**
   * The node label(s) for users in your database.
   * - defaults to 'User'
   * - e.g. for userType: 'Uuser', matches will look like `MATCH (me:Uuser) ...`
   */
  userType?: string;
}

export interface Context {
  /**
   * Base set of cypherParams including args provided by GraphQL and requestor credentials.
   */
  cypherParams: { [index: string]: any; _credentials: Credentials };
  /**
   * Current Neo4jDriver instance
   */
  driver: Driver;
  /**
   * Retrieve the requestor's full node
   * - returns null if improperly authenticated or user doesn't exist
   */
  getMe: () => Promise<object | null>;
  /**
   * Returns the current Neo4j session for this request
   */
  getNeo4jSession: () => Session;
  /**
   * Returns a Neo4j transaction open for this request
   */
  getTx: () => Promise<Transaction>;
  /**
   * Indicates whether the current requestor is authenticated
   */
  hasCredentials: boolean;
  /**
   * Run an arbitrary Cypher query using the current open transaction for this request
   * - if `columns` is provided, will
   */
  query: <Columns extends readonly string[] | undefined>(
    req: string,
    params: Record<string, any>,
    columns?: Columns,
  ) => Columns extends readonly string[] ? Promise<Record<Columns[number], any>[]> : Promise<QueryResult>;
  /**
   * Current request object
   */
  req: any;
  /**
   * Current request's session object
   * - use this for storing user credentials
   */
  session: any;
}

export declare function buildContext<T>(
  driver: Driver,
  config: {
    credentials: {
      /**
       * A function for constructing the cypherParams object from an incoming JWT object
       * - defaults to (jwt) => jwt
       */
      extract?: (jwt: object) => Credentials
      /**
       * The set of keys expected to be included in the JWT which will identify the current user.
       * - defaults to ['_id']
       * - if '_id' is included it will perform use the special cypher id matching pattern
       *   - e.g. `MATCH (me) WHERE id(me) = $cypherParams._credentials._id ...`
       * - all other keys will be matchedin the standard cypher object pattern
       *   - e.g. for keys: ['uuid'], `MATCH (me { uuid: $cypherParams._credentials.uuid }) ...`
       */
      keys?: T;
    };
    /**
     * The node label(s) for users in your database.
     * - defaults to 'User'
     * - e.g. for userType: 'Uuser', matches will look like `MATCH (me:Uuser) ...`
     */
    userType?: string;
  },
): <K extends any[]>(...args: K) => Context;
