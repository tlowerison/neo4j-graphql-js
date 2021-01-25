# @tlowerison/neo4j-graphql-js

This fork of [neo4j-graphql-js](https://github.com/neo4j-graphql/neo4j-graphql-js) provides a set of schema directives to implement legible, declarative and dynamic authorization in your GraphQL Schemas.

## Installation

```
yarn add @tlowerison/neo4j-graphql-js
```

## Full Example

A full example project that uses `@tlowerison/neo4j-graphql-js` exists in [GRAND Stack Kit](https://github.com/tlowerison/grandstack-kit)'s api directory.

## Directives

### @shield

```graphql
@shield(expression: String!, errorCode: String, errorMessage: String) on FIELD_DEFINITION | OBJECT | INTERFACE
```

Can limit access to a specific type's field or to all object type fields that return a specific type.

Arguments:

- `expression`: a valid Cypher expression
- `errorCode`: if present and `expression` is falsey, the resolver will throw an ApolloError whose `extensions.code` field is a `;` delimited string containing the `errorCode` values of all `expression`s that are falsey for this operation. If not present and `expression` is falsey, the resolver will silently return _NULL_ and not execute the operation.
  - NOTE: `errorCode` is used as a Cypher string, not an expression
- `errorMessage`: any ApolloError thrown due to dynamic auth errors will have an error message containing the failing conditions' `errorMessage`s delimited by `;`
  - NOTE: `errorCode` is used as a Cypher expression, not a string

Scoped Cypher Variables:

- `this`: aliases to another variable dependent on where `@shield` is attached:
  - _FIELD_DEFINITION_: aliases to the parent object/interface
  - _OBJECT | INTERFACE_: aliases to the object/interface itself

If `@shield` is placed on a field definition, any Cypher queries attached to that field are executed only after `expression` is evaluated to be truthy. The _after_ part is crucial, that way custom mutations using the `@cypher` directive are executed _after_ passing all attached `@shield`s.

If `@shield` is placed on an object/interface definition, the effect is that all field definitions with that type are shielded in the same way described above. _If_ the field definition's type is an array of the object, only objects satisfying `expression` will be returned in the array (no errors thrown for non-satisfying values).

###### Example

To ensure a user must be signed in order to view data about anyone, we can add a shield directly to an object definition. (NOTE: this is not the preferred way to check if a user is signed in, check out `@roles` for a better implementation)

```graphql
type User @shield(expression: "me IS NOT NULL") {
  uuid: ID! @id
  username: String
  ...
}
```

Now, for requests without valid credentials to the built-in node query `User`, the response will always be

```json
{ "data": { "User": [] } }
```

###### Example

Another basic example is shielding fields of one object based off its relation with the signed in user. For example, say we only want to show a user's birthday to their friends.

```graphql
type User {
  uuid: ID! @id
  username: String
  friends: [User] @relation(name: "KNOWS", direction: "OUT")
  birthday: String @shield(expression: "(me)-[:KNOWS]-(this)")
}
```

###### Example

An example of using shield errors look like this

```graphql
type User {
  uuid: ID! @id
  username: String
  friends: [User] @relation(name: "KNOWS", direction: "OUT")
  birthday: String
    @shield(
      expression: "(me)-[:KNOWS]-(this)"
      errorCode: "UNAUTHORIZED"
      errorMessage: "'You can only view your friends' birthdays'"
    )
}
```

Then a query without proper credentials would give a result like this

```json
{
  "errors": [
    {
      "message": "You can only view your friends' birthdays",
      "locations": [
        {
          "line": 2,
          "column": 3
        }
      ],
      "path": ["User", "birthday"],
      "extensions": {
        "code": "UNAUTHORIZED",
        "exception": {
          "stacktrace": [
            "Error: UNAUTHORIZED",
            "    at throwDynamicAuthError (path/to/project/node_modules/@tlowerison/neo4j-graphql-js/dist/dynamic-auth/throw-dynamic-auth-error.js:18:9)",
            "    at extractQueryResult (path/to/project/node_modules/@tlowerison/neo4j-graphql-js/dist/utils.js:189:46)",
            "    at _callee2$ (path/to/project/node_modules/@tlowerison/neo4j-graphql-js/dist/index.js:244:89)",
            "    at tryCatch (path/to/project/node_modules/regenerator-runtime/runtime.js:63:40)",
            "    at Generator.invoke [as _invoke] (path/to/project/node_modules/regenerator-runtime/runtime.js:293:22)",
            "    at Generator.next (path/to/project/node_modules/regenerator-runtime/runtime.js:118:21)",
            "    at asyncGeneratorStep (path/to/project/node_modules/@babel/runtime-corejs3/helpers/asyncToGenerator.js:5:24)",
            "    at _next (path/to/project/node_modules/@babel/runtime-corejs3/helpers/asyncToGenerator.js:27:9)",
            "    at process._tickCallback (internal/process/next_tick.js:68:7)"
          ]
        }
      }
    }
  ],
  "data": null
}
```

### @filter

```graphql
@filter(expression: String!) on FIELD_DEFINITION
```

Limits access to specific elements in list types.

Arguments:

- `expression`: a valid Cypher WHERE clause

Scoped Cypher Variables:

- `item`: refers to the current item being assessed in the WHERE clause

NOTE: `@filter` will not throw any errors when filtering out inaccessible items

###### Example

A basic example is if you wanted to filter an array of booleans to only ever include false values.

```graphql
type Foo {
  stuff: [Boolean] @filter(expression: "NOT item")
}
```

`item` will be evaluated as each actual boolean item in the list, so any query for `Foo.stuff` will return a list of only false values.

###### Example

Continuing with the social-media-esque examples, a typical feature of these platforms is to narrow visibility of a user's friends to only include the mutual friends between the user in question and the requesting user. Making that happen with the `@filter` directive is stupid easy

```graphql
type User {
  uuid: ID!
  username: String
  friends: [User]
    @relation(name: "KNOWS", direction: "OUT")
    @filter(expression: "(me)-[:KNOWS]-(item)")
}
```

### @roles / @scopes

```graphql
@roles(any: [roleType!], all: [roleType!], none: [roleType!], notAll: [roleType!]) on FIELD_DEFINITION | OBJECT | INTERFACE
@scopes(any: [scopeType!], all: [scopeType!], none: [scopeType!], notAll: [scopeType!]) on FIELD_DEFINITION | OBJECT | INTERFACE
```

Limits access to resources based on role values stored in requestor credentials.

- `any`: grant access if the requestor's roles/scopes include any of the specified values
- `all`: grant access if the requestor's roles/scopes include all of the specified values
- `none`: grant access if the requestor's roles/scopes do not include any of the specified values
- `notAll`: grant access if the requestor's roles/scopes do not include all of the specified values

Both of these directives require exactly one of the above arguments.

`roleType` / `scopeType` can either be `String` or the name of an Enum type. They can both be specified in the config passed to `makeAugmentedSchema` (see section below). `roleType` defaults to `Role` and `scopeType` defaults to `Scope`.

###### Example

The preferred way to limit access to a resource based on login status is by assigning a user role to each user and attaching it to their scope on login. (NOTE: Make sure to create the correct roles for each user on creation)

```graphql
type Role {
  ADMIN
  USER
}

type Scope {
  WRITE_ME
}

type User @roles(any: [USER]) {
  uuid: ID! @id
  username: String
  roles: [Role] @admin
  ...
}

type Mutation {
  # Would typically require email on SignUp as well as enforce validation
  # rules on email, username and password, excluded here for brevity
  CreateAdmin(username: String!, password: String!): User
    @roles(any: [ADMIN])
    @cypher(statement: """
      CREATE (user:User {
        uuid: apoc.create.uuid(),
        username: $username,
        password: $password,
        roles: ['ADMIN', 'USER'],
      })
      RETURN user
    """)

  # Would typically require email on SignUp as well as enforce validation
  # rules on email, username and password, excluded here for brevity
  SignUp(username: String!, password: String!): User
    @cypher(statement: """
      CREATE (user:User {
        uuid: apoc.create.uuid(),
        username: $username,
        password: $password,
        roles: ['USER'],
      })
      RETURN user
    """)

  UpdateMe(username: String): User
    @roles(any: [USER])
    @scopes(any: [WRITE_ME])
    @cypher(statement: """
      SET me.username = CASE WHEN $username IS NOT NULL
        THEN $username
        ELSE me.username END
    """)
}
```

If you're using JWTs to provide credentials, make sure the tokens you produce have a `roles` field and a `scopes` field. If you're using cookies to provide credentials, make sure to attach them to the session on sign in.

### @env

```graphql
@env(provides: String!) on FIELD_DEFINITION
```

Matches variables and provides them to the generated Cypher query, scoped to the parent object where this directive is attached.

- `provides`: a valid Cypher statement; should not use the RETURN clause here

This one's mostly useful for avoiding duplicate matching in `@cypher` on custom queries / mutations.

###### Example

```graphql
type Mutation {
  PokeFriend(userUUID: ID!): Boolean
    @env(provides: "MATCH (user:User { uuid: $userUUID })")
    @shield(expression: "(me)-[:KNOWS]-(user)")
    @cypher(
      statement: """
      CREATE (me)-[:POKED { timestamp: apoc.date.currentTimestamp() }]->(user)
      RETURN TRUE
      """
    )
}
```

### `me` Variable

The `me` variable is a globally scoped variable, available at every level of the generated query and therefore available in any directive using Cypher attached anywhere in your schema. It's evaluated as a node matched according to the requestor's credentials. If the credentials provided are not valid or no users are matched with those credentials, `me` evaluates to NULL and is still provided globally.

## Aliases

The main goal of this project is to make authorization in GraphQL as declarative as possible, but in the process of adding those authorization directives, the schema also becomes bloated with `expression` strings. In order to keep the schema as DRY as possible, we should declare aliases for any repeated authorization patterns.

Here are some example alias declarations (alias declarations can include up to one instance of each authorization directive)

```graphql
@admin := @roles(any: [ADMIN])
@user := @roles(any: [ADMIN, USER])

@writeMe := @scopes(all: [WRITE_ME])

@me := @shield(expression: "'ADMIN' IN me.roles OR this = me")

@knows := @shield(expression: "(me)-[:KNOWS]-(this)")

@uniqueUsername :=
  @env(provides: "OPTIONAL MATCH (userByUsername:User { username: $username }) WHERE userByUsername <> this")
  @shield(
    expression: "userByUsername IS NULL",
    error: "Username taken"
  )

@validUsername := @shield(
  expression: """
    $username IS NULL OR
    $username =~ '^(?=[a-zA-Z0-9._]{8,20}$)(?!.*[_.]{2})[^_.].*[^_.]$'
  """,
  error: "Invalid username"
)
```

We can then use these aliases in our main schema

```graphql
type Role {
  ADMIN
  USER
}

type Scope {
  WRITE_ME
}

type User @user {
  uuid: ID! @id
  email: String @me
  username: String
  password: String @admin
  birthday: String @knows
  friends: [User] @relation(name: "KNOWS", direction: "OUT")
    @filter(expression: "(me)-[:KNOWS]-(item)")
}

type Mutation {
  PokeFriend(userUUID: ID!): Boolean
    @env(provides: "MATCH (user:User { uuid: $userUUID })")
    @knows(this: "user")
    @cypher(statement: """
      CREATE (me)-[:POKED { timestamp: apoc.date.currentTimestamp() }]->(user)
      RETURN TRUE
    """)

  UpdateMe(username: String): Boolean
    @user
    @writeMe
    @uniqueUsername(this: "me")
    @validUsername
    @cypher(statement: """
      SET me.username = CASE WHEN $username IS NOT NULL THEN $username ELSE me.username END
      RETURN TRUE
    """)

  UpdateUser(userUUID: ID!, username: String): Boolean
    @env(provides: "MATCH (user:User { uuid: $userUUID })")
    @admin
    @uniqueUsername(this: "user")
    @validUsername
    @cypher(statement: """
      SET user.username = CASE WHEN $username IS NOT NULL THEN $username ELSE user.username END
      RETURN TRUE
    """)
}
```

This package really doesn't care where those declarations live, as long as they end up in a string, pased to `config.auth.typeDefs` in `makeAugmentedSchema` (see in the below section), although if you are going to place them in separate files, they should use the `.auth` file extension.

## Library

### makeAugmentedSchema

Wraps makeExecutableSchema to create a GraphQL schema from GraphQL type definitions (SDL). Will generate Query and Mutation types for the provided type definitions and attach neo4jgraphql as the resolver for these queries and mutations. Either a schema or typeDefs must be provided. resolvers can optionally be implemented to override any of the generated Query/Mutation fields. Additional options are passed through to makeExecutableSchema.

###### Example Usage

```ts
import { GraphQLSchema } from 'graphql';
import { makeAugmentedSchema, readFiles } from '@tlowerison/neo4j-graphql-js';
import { resolvers } from './resolvers';

export const schema: GraphQLSchema = makeAugmentedSchema({
  resolvers,
  config: {
    auth: {
      typeDefs: readFiles('./**/*.auth')
    },
    mutation: false
  },
  typeDefs: readFiles('./**/*.graphql')
});
```

###### Typescript Definition

```ts
export declare function makeAugmentedSchema<TContext extends Context>(
  options: IExecutableSchemaDefinition<TContext> & { config: Config }
): GraphQLSchema;

type Config = {
  auth?: {
    /**
     * GraphQL enum type name containing role names
     * - if you'd like to allow any value as a role, use roleType: 'String'
     * - defaults to 'Role'
     */
    roleType?: string;
    /**
     * GraphQL enum type name containing scope names
     * - if you'd like to allow any value as a scope, use scopeType: 'String'
     * - defaults to 'Scope'
     */
    scopeType?: string;
    /**
     * Contains authorization directive definitions living in .auth files
     */
    typeDefs?: string;
  };
  /**
   * Enable/disable logging of generated Cypher queries and parameters
   */
  debug?: boolean;
  /**
   * Configure the autogenerated Query fields
   * - can be enabled/disabled for all types or a list of individual types to exclude can be passed
   * - commonly used to exclude payload types
   */
  query?:
    | boolean
    | {
        exclude: string[];
      };
  /**
   * Configure the autogenerated Mutation fields
   * - can be enabled/disabled for all types or a list of individual types to exclude can be passed
   * - commonly used to exclude payload types
   */
  mutation?:
    | boolean
    | {
        exclude: string[];
      };
};
```

### buildContext

Builds a context object from the provided driver, config and request. The `Context` type is provided to every GraphQL resolver.

###### Example Usage

```ts
import { ApolloServer } from 'apollo-server-express';
import { Neo4jPlugin, buildContext } from '@tlowerison/neo4j-graphql-js';

const driver = neo4j.driver(
  `${NEO4J_PROTOCOL}://${NEO4J_HOST}:${NEO4J_PORT}`,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

const apolloServer = new ApolloServer({
  schema,
  context: buildContext(driver, { credentials: { keys: ['uuid'] } }),
  introspection: true,
  playground:
    process.env.NODE_ENV === 'production'
      ? false
      : {
          settings: {
            'request.credentials': 'same-origin'
          }
        },
  plugins: [Neo4jPlugin],
  subscriptions: false
});
```

###### Typescript Definition

```ts
import { Driver, QueryResult, Session, Transaction } from 'neo4j-driver';

type Credentials = { [index: string]: any; roles: string[]; scopes: string[] };

export declare function buildContext<>(
  driver: Driver,
  config: {
    credentials: {
      /**
       * A function for constructing the cypherParams object from an incoming JWT object
       * - defaults to (jwt) => jwt
       */
      extract?: (jwt: object) => Credentials;
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
): <K extends any[]>(...args: K) => Context;

export interface ContextConfig {
  credentials: {
    /**
     * A function for constructing the cypherParams object from an incoming JWT object
     * - defaults to (jwt) => jwt
     */
    extract?: (jwt: object) => Credentials;
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
   * Run an arbitrary Cypher query using the current open transaction for this request
   * - if `columns` is provided, will
   */
  query: <Columns extends readonly string[] | undefined>(
    req: string,
    params: Record<string, any>,
    columns?: Columns
  ) => Columns extends readonly string[]
    ? Promise<Record<Columns[number], any>[]>
    : Promise<QueryResult>;
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
```

### Neo4jPlugin

An Apollo plugin which terminates any open driver sessions/transactions when a request is ready to be sent. NOTE: This must be included if you want to open your own sessions/transactions using `Context.getMe`, `Context.getTx`, `Context.getNeo4jSession` or `Context.query`.

###### Example Usage

See `buildContext`'s example usage.

###### Typescript Definition

```ts
import { ApolloServerPlugin } from 'apollo-server-plugin-base';
export const Neo4jPlugin: ApolloServerPlugin;
```

### readFiles

Given a glob pattern, return the result of concatenating all the contents of the matched files.

###### Example Usage

See `makeAugmentedSchema`'s example usage.

###### Typescript Definition

```ts
export declare function readFiles(pattern: string): string;
```

### AuthorizationError

A wrapper for ApolloError with a default message of `"Unauthorized"`.

###### Example Usage

```ts
import { AuthorizationError } from '@tlowerison/neo4j-graphql-js';
throw new AuthorizationError({ message: 'Cannot access this resource' });
```

###### Typescript Definition

```ts
export declare class AuthorizationError extends Error {
  constructor(arg0?: { message: string });
}
```
