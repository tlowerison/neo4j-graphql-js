[![CI status](https://circleci.com/gh/neo4j-graphql/neo4j-graphql-js.svg?style=shield&circle-token=d01ffa752fbeb43585631c78370f7dd40528fbd3)](https://circleci.com/gh/neo4j-graphql/neo4j-graphql-js) [![codecov](https://codecov.io/gh/neo4j-graphql/neo4j-graphql-js/branch/master/graph/badge.svg)](https://codecov.io/gh/neo4j-graphql/neo4j-graphql-js) [![npm version](https://badge.fury.io/js/neo4j-graphql-js.svg)](https://badge.fury.io/js/neo4j-graphql-js) [![Docs link](https://img.shields.io/badge/Docs-GRANDstack.io-brightgreen.svg)](http://grandstack.io/docs/neo4j-graphql-js.html)

# neo4j-graphql.js

A GraphQL to Cypher query execution layer for Neo4j and JavaScript GraphQL implementations.

- [Read the docs](https://grandstack.io/docs/neo4j-graphql-js.html)
- [Read the changelog](https://github.com/neo4j-graphql/neo4j-graphql-js/blob/master/CHANGELOG.md)

_neo4j-graphql-js is in active development. There are rough edges and APIs may change. Please file issues for any bugs that you find or feature requests._

## Installation and usage

Install

```
npm install --save neo4j-graphql-js
```

### Usage

GraphQL type defintions

###### nodes.graphql

```graphql
enum Role {
  ADMIN
  USER
}

type User @user {
  uuid: ID! @id
  username: String
  email: String @me
  password: String @admin
  roles: [Role] @admin
  friends: [User] @relation(name: "KNOWS", direction: "OUT") @mutuallyKnows
  favoriteMovies: [Movie] @relation(name: "APPRECIATES", direction: "OUT") @knows
  suggestions: [Suggestion] @relation(name: "RECEIVED_SUGGESTION", direction: "IN") @me
}

type Movie {
  uuid: ID! @id
  title: String
  year: Int
  imdbRating: Float
  fans: [User] @relation(name: "APPRECIATES", direction: "IN") @admin
}

type Genre {
  uuid: ID! @id
  name: String
  movies: [Movie] @relation(name: "IN_GENRE", direction: "IN")
}

type Suggestion @user @inSuggestion {
  suggestee: User @relation(name: "RECEIVED_SUGGESTION", direction: "OUT")
  suggestor: User @relation(name: "SENT_SUGGESTION", direction: "IN")
  movie: Movie @relation(name: "IN_SUGGESTION", direction: "IN")
}
```

GraphQL-Cypher auth directives:

###### directives.auth

```graphql
# Authn
@user := @authn(requires: [USER])
@admin := @authn(requires: [ADMIN])

# Authz
@me := @authz(requires: "'ADMIN' IN me.roles OR this = me")

@knows := @authz(requires: """
  'ADMIN' IN me.roles OR
  this = me OR
  (me)-[:KNOWS]-(this)
""")

@mutuallyKnows := @authz(requires: """
  'ADMIN' IN me.roles OR
  this = me OR
  (me)-[:KNOWS*..2]-(this)
""")

@inSuggestion := @authz(requires: """
  (me)-[:RECEIVED_SUGGESTION|SENT_SUGGESTION]-(this)
""")
```

###### operations.graphql

```graphql
type Query {
  Me: User @user @cypher(statement: "RETURN me")
}

type Mutation {
  AppreciateMovie(movieUUID: ID!): User
    @user
    @cypher(statement: """
      MATCH (movie:Movie { uuid: $movieUUID })
      MERGE (me)-[:APPRECIATES]->(movie)
      RETURN me
    """)

  DeleteMe: Boolean
    @user
    @cypher(statement: """
      DETACH DELETE me
      RETURN TRUE
    """)

  DeleteUser(userUUID: ID!): Boolean
    @admin
    @cypher(statement: """
      MATCH (user:User { uuid: $userUUID })
      DETACH DELETE user
      RETURN TRUE
    """)

  SuggestMovieToFriend(movieUUID: ID!, userUUID: ID!): Suggestion
    @user
    @knows(this: "user")
    @env(provides: "MATCH (user:User { uuid: $userUUID })")
    @cypher(statement: """
      MATCH (movie:Movie { uuid: $movieUUID })
      MERGE (me)-[:SENT_SUGGESTION]->(suggestion:Suggestion)-[:RECEIVED_SUGGESTION]->(user)
      MERGE (movie)-[:IN_SUGGESTION]->(suggestion)
      RETURN suggestion
    """)
}
```

Create an executable schema with auto-generated resolvers for Query and Mutation types, ordering, pagination, and support for computed fields defined using the `@cypher` GraphQL schema directive:

```javascript
import { compare, hash } from 'bcrypt';
import { join } from 'path';
import { makeAugmentedSchema } from 'neo4j-graphql-js';
import { readFileSync } from 'fs';
import { sync } from 'glob';

const readFiles = (pattern: string) =>
  sync(join(__dirname, pattern))
    .map(filename => readFileSync(filename, 'utf-8'))
    .join('\n');

const getMe = async ({ session, tx }) => {
  const {
    records: [record]
  } = await tx.run('MATCH (me:User { uuid: $uuid }) RETURN me { .* }', {
    uuid: session?.me?.uuid
  });
  return (record && record.get('me')) || null;
};

export const schema = makeAugmentedSchema({
  config: {
    auth: readFiles('./**/*.auth'),
    mutation: false
  },
  typeDefs: readFiles('./**/*.graphql'),
  resolvers: {
    // Assumes you're using some session management middleware (e.g. express-session)
    login: async (_parent, { email, password }, { session, tx }) => {
      if (session?.me?.uuid) return await getMe({ session, tx });
      const {
        records: [record]
      } = await tx.run('MATCH (me:User { email: $email }) RETURN me { .* }', {
        email
      });
      if (!record) return null;
      const { password: passwordHash, ...me } = record.get('me');
      if (!me || !(await compare(password, passwordHash))) return null;
      if (session) session.me = me;
      return { ...me, password: null };
    }
  }
});
```

Create a neo4j-javascript-driver instance:

```javascript
import { v1 as neo4j } from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'letmein')
);
```

Use your favorite JavaScript GraphQL server implementation to serve your GraphQL schema, injecting the Neo4j driver instance into the context so your data can be resolved in Neo4j:

```javascript
import { ApolloServer } from 'apollo-server';

const server = new ApolloServer({ schema, context: { driver } });

server.listen(3003, '0.0.0.0').then(({ url }) => {
  console.log(`GraphQL API ready at ${url}`);
});
```

If you don't want auto-generated resolvers, you can also call `neo4jgraphql()` in your GraphQL resolver. Your GraphQL query will be translated to Cypher and the query passed to Neo4j.

```js
import { neo4jgraphql } from 'neo4j-graphql-js';

const resolvers = {
  Query: {
    Movie(object, params, ctx, resolveInfo) {
      return neo4jgraphql(object, params, ctx, resolveInfo);
    }
  }
};
```

## What is `neo4j-graphql.js`

A package to make it easier to use GraphQL and [Neo4j](https://neo4j.com/) together. `neo4j-graphql.js` translates GraphQL queries to a single [Cypher](https://neo4j.com/developer/cypher/) query, eliminating the need to write queries in GraphQL resolvers and for batching queries. It also exposes the Cypher query language through GraphQL via the `@cypher` schema directive.

### Goals

- Translate GraphQL queries to Cypher to simplify the process of writing GraphQL resolvers
- Allow for custom logic by overriding of any resolver function
- Work with `graphql-tools`, `graphql-js`, and `apollo-server`
- Support GraphQL servers that need to resolve data from multiple data services/databases
- Expose the power of Cypher through GraphQL via the `@cypher` directive

## Benefits

- Send a single query to the database
- No need to write queries for each resolver
- Exposes the power of the Cypher query language through GraphQL

## Contributing

See our [detailed contribution guidelines](./CONTRIBUTING.md).

## Examples

See [/examples](https://github.com/neo4j-graphql/neo4j-graphql-js/tree/master/example/apollo-server)

## [Documentation](http://grandstack.io/docs/neo4j-graphql-js.html)

Full docs can be found on [GRANDstack.io/docs](http://grandstack.io/docs/neo4j-graphql-js.html)

## Debugging and Tuning

You can log out the generated cypher statements with an environment variable:

```
DEBUG=neo4j-graphql-js node yourcode.js
```

This helps to debug and optimize your database statements. E.g. visit your Neo4J
browser console at http://localhost:7474/browser/ and paste the following:

```
:params :params { offset: 0, first: 12, filter: {}, cypherParams: { currentUserId: '42' } }
```

and now profile the generated query:

```
EXPLAIN MATCH (`post`:`Post`) WITH `post` ORDER BY post.createdAt DESC RETURN `post` { .id , .title } AS `post`
```

You can learn more by typing:

```
:help EXPLAIN
:help params
```
