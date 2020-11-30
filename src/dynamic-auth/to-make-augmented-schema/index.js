import {
  authorizations,
  makeAuthenticationDirective,
  makeAuthorizationDirective
} from './dynamic-auth';
const {
  addIndex,
  compose,
  fromPairs,
  groupBy,
  has,
  identity,
  keys,
  last,
  lensPath,
  mapObjIndexed,
  multiply,
  omit,
  slice,
  sortBy,
  toPairs,
  transpose,
  values,
  view,
  zip
} = require('ramda');
const { matchRecursive } = require('xregexp');

const directives = {
  authn: {
    customParams: [],
    params: [
      {
        name: 'requires',
        wrappers: [{ left: '[', right: ']' }]
      }
    ]
  },
  authz: {
    customParams: [
      {
        name: 'this',
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ],
    params: [
      {
        name: 'requires',
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ]
  },
  env: {
    customParams: [],
    params: [
      {
        name: 'provides',
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ]
  }
};

const valueNames = ['between', 'left', 'match', 'right'];
const nest = compose(
  values,
  addIndex(groupBy)((_, i) => Math.floor(i / valueNames.length))
);
const isValidNesting = ([between, left, match, right]) =>
  between &&
  between.name === 'between' &&
  left &&
  left.name === 'left' &&
  match &&
  match.name === 'match' &&
  right &&
  right.name === 'right';

const name = '[A-z_][A-z_0-9]+';
const space = '( |\t|\n)*';
const directive = `(${keys(directives).join('|')})`;
const definition = `${space}@${name}${space}:=${space}@${directive}${space}`;
const isDefinition = text => text.match(new RegExp(definition, 'g'));

const match = (text, regex) => {
  let matched;
  const indices = [];
  while ((matched = regex.exec(text))) {
    indices.push({
      value: matched[0],
      start: matched.index,
      end: matched.index + matched[0].length
    });
  }
  return indices;
};

const getDirectiveAST = config => {
  if (typeof config.auth !== 'string') return;
  const recursiveMatches = nest(
    matchRecursive(config.auth, '\\(', '\\)', 'gi', { valueNames })
  );
  if (recursiveMatches.length === 0) return recursiveMatches;
  const lastRecursiveMatch = last(recursiveMatches);
  const canLastRecursiveMatchBeTrimmed =
    lastRecursiveMatch.length === 1 && lastRecursiveMatch[0].name === 'between';
  if (
    !(
      slice(0, -1, recursiveMatches).every(isValidNesting) &&
      (isValidNesting(lastRecursiveMatch) || canLastRecursiveMatchBeTrimmed)
    )
  ) {
    throw new Error('Bad syntax 1');
  }
  if (canLastRecursiveMatchBeTrimmed) {
    recursiveMatches.pop();
  }
  return mungeRecursiveMatches(recursiveMatches);
};

const mungeRecursiveMatches = recursiveMatches =>
  recursiveMatches.reduce((acc, [between, left, match, right]) => {
    let betweenValue = between.value.trim();
    betweenValue = betweenValue.slice(betweenValue.match('@').index);
    const matchValue = match.value.trim();
    if (isDefinition(betweenValue)) {
      const [nameValue, directiveValue] = betweenValue
        .split(':=')
        .map(e => e.trim().slice(1));
      if (!directiveValue.match(directive)) {
        throw new Error(`Directive ${directiveValue} is not defined.`);
      }
      return [
        ...acc,
        {
          name: nameValue,
          instances: [
            {
              name: directiveValue,
              args: fromPairs(
                zip(
                  directives[directiveValue].params.map(({ name }) => name),
                  getDirectiveInputs(
                    matchValue,
                    directiveValue,
                    directives[directiveValue].params
                  ).map(({ value }) => value)
                )
              )
            }
          ]
        }
      ];
    }
    const directiveValue = betweenValue.slice(1);
    const prev = last(acc);
    return [
      ...slice(0, -1, acc),
      {
        ...prev,
        instances: [
          ...prev.instances,
          {
            name: betweenValue.slice(1),
            args: fromPairs(
              zip(
                directives[directiveValue].params.map(({ name }) => name),
                getDirectiveInputs(
                  matchValue,
                  directiveValue,
                  directives[directiveValue].params
                ).map(({ value }) => value)
              )
            )
          }
        ]
      }
    ];
  }, []);

const getDirectiveInputs = (matchValue, directiveValue, inputs) =>
  inputs.map(({ name, wrappers }) => {
    const mungedValues = wrappers.map(({ left, right }) => {
      try {
        return matchRecursive(
          matchValue,
          `${name}( |\n|\t)*:( |\n|\t)*\\${left}`,
          `\\${right}`,
          'gi'
        )[0];
      } catch (e) {
        return undefined;
      }
    });
    const index = mungedValues.findIndex(identity);
    if (index === -1) {
      throw new Error(
        `Directive ${directiveValue} expected "${name}" argument but didn't receive one.`
      );
    }
    const { left, right } = wrappers[index];
    return { name, value: `${left}${mungedValues[index]}${right}` };
  });

const replaceCustomDirectives = config => {
  const directiveAST = getDirectiveAST(config);
  const customDirectives = fromPairs(
    directiveAST.map(({ instances, name }) => [name, instances])
  );

  let typeDefs = config.typeDefs;
  const calledCustomDirectiveInstances = matchRecursive(
    typeDefs,
    '\\(',
    '\\)',
    'gi',
    { valueNames }
  );
  const calledInstances = calledCustomDirectiveInstances
    .map((e, index) => ({ ...e, index }))
    .filter(
      ({ name, index, value }) =>
        name === 'between' &&
        has(value.slice(value.lastIndexOf('@') + 1), customDirectives) &&
        index < calledCustomDirectiveInstances.length - 3
    )
    .map(({ index, value, end }) => {
      const matchValue = calledCustomDirectiveInstances[index + 2].value;
      const directiveValue = value.slice(value.lastIndexOf('@') + 1);
      if (
        customDirectives[directiveValue].filter(({ name }) => name === 'authz')
          .length === 0
      ) {
        throw new Error(
          `Cannot call @${directiveValue} because it does not implement the @authz directive`
        );
      }
      return {
        name: directiveValue,
        start: end - (value.length - value.lastIndexOf(`@${directiveValue}`)),
        end: calledCustomDirectiveInstances[index + 3].end,
        directives: customDirectives[directiveValue].map(({ name }) => ({
          name,
          args:
            directives[name].customParams.length > 0
              ? fromPairs(
                  zip(
                    directives[name].customParams.map(({ name }) => name),
                    getDirectiveInputs(
                      matchValue,
                      name,
                      directives[name].customParams
                    ).map(({ value }) => value)
                  )
                )
              : {}
        }))
      };
    });

  const uncalledInstances = match(
    config.typeDefs,
    new RegExp(`@(${keys(customDirectives).join('|')})( |\n|\t)`, 'g')
  ).map(({ end, start, value }) => {
    const directiveValue = value.slice(1, value.length - 1);
    return {
      name: directiveValue,
      start,
      end: end - 1,
      directives: customDirectives[directiveValue].map(({ name }) => ({
        name,
        args: {}
      }))
    };
  });

  const instances = sortBy(compose(multiply(-1), view(lensPath(['start']))), [
    ...calledInstances,
    ...uncalledInstances
  ]);

  const slices = new Array(2 * instances.length + 1).fill('');
  let runningEnd = config.typeDefs.length;
  for (let i = 0; i < instances.length; i += 1) {
    const { directives, end, name, start } = instances[i];
    slices[2 * i] = config.typeDefs.slice(end, runningEnd);
    slices[2 * i + 1] = zip(customDirectives[name], directives)
      .map(
        ([instance, customInstance]) =>
          `@${instance.name}(${toPairs(instance.args)
            .map(
              ([name, value]) =>
                `${name}: ${toPairs(customInstance).reduce(
                  (acc, [replaceName, replaceValue]) =>
                    acc.replace(new RegExp(replaceName, 'g'), replaceValue),
                  value
                )}`
            )
            .join(', ')})`
      )
      .join('\n');
    runningEnd = start;
  }
  slices.reverse();
  console.log(slices.join(''));
};

export const toMakeAugmentedSchema = makeBasicAugmentedSchema => config => {
  const authn = fromPairs(
    config.typeDefs
      .match(
        new RegExp(
          '#( )+@([A-z]+)( )+:=( )+@authn\\(requires:( )*\\[([A-z]+,)*( )*([A-z]+)\\]\\)',
          'g'
        )
      )
      ?.map(definition => {
        let [name] = definition.match(new RegExp('(?<=@)([A-z]+)'));
        let [roles] = definition.match(
          new RegExp('(?<=requires:)( )*\\[([A-z]+,)*( )*([A-z]+)\\]')
        );
        roles = roles.trim();
        return [
          name,
          roles
            .slice(1, roles.length - 1)
            .split(',')
            .map(role => role.trim())
        ];
      }) || {}
  );
  const authz = fromPairs(
    config.typeDefs
      .match(
        new RegExp(
          '#( )+@([A-z]+)( )+:=( )+@authz\\(requires:( )*(\'.*\'|".*"|`.*`)\\)',
          'g'
        )
      )
      ?.map(definition => {
        let [name] = definition.match(new RegExp('(?<=@)([A-z]+)'));
        let [requires] = definition.match(
          new RegExp('(?<=requires:)( )*(\'.*\'|".*"|`.*`)')
        );
        requires = requires.trim();
        return [name, requires.slice(1, requires.length - 1)];
      }) || {}
  );
  const typeDefs = `
    directive @authn(requires: [Role]) on FIELD_DEFINITION | INTERFACE | OBJECT | UNION
    directive @authz(requires: String!) on FIELD_DEFINITION | INTERFACE | OBJECT | UNION
    directive @env(provides: String!) on FIELD_DEFINITION
    ${
      typeof authn === 'object'
        ? toPairs(authn)
            .map(
              ([name]) =>
                `directive @${name} on FIELD_DEFINITION | INTERFACE | OBJECT | UNION`
            )
            .join('\n')
        : ''
    }
    ${
      typeof authz === 'object'
        ? toPairs(authz)
            .map(
              ([name]) =>
                `directive @${name} on FIELD_DEFINITION | INTERFACE | OBJECT | UNION`
            )
            .join('\n')
        : ''
    }
    ${config.typeDefs}
  `;
  const Query = { ...(config.resolvers?.Query || {}) };
  const Mutation = { ...(config.resolvers?.Mutation || {}) };
  const tempSchema = makeBasicAugmentedSchema({
    ...config,
    schemaDirectives: makeSchemaDirectives(
      config.schemaDirectives,
      authn,
      authz,
      authorizations
    ),
    typeDefs
  });
  const resolvers = {
    ...config.resolvers,
    Query: {
      ...(config?.config?.query === false
        ? fromPairs(
            keys(tempSchema.getQueryType()?.getFields() || {})
              .filter(key => !has(key, Query))
              .map(key => [key, neo4jgraphql])
          )
        : config.resolvers?.Query),
      ...Query
    },
    Mutation: {
      ...(config?.config?.mutation === false
        ? fromPairs(
            keys(tempSchema.getMutationType()?.getFields() || {})
              .filter(key => !has(key, Mutation))
              .map(key => [key, neo4jgraphql])
          )
        : config.resolvers?.Mutation),
      ...Mutation
    }
  };
  return makeBasicAugmentedSchema({
    ...config,
    resolvers,
    schemaDirectives: makeSchemaDirectives(
      config.schemaDirectives,
      authn,
      authz
    ),
    typeDefs
  });
};

// const config = {
//   auth: `# Authn
// @admin := @authn(requires: [ADMIN])
// @user := @authn(requires: [ADMIN, USER])
//
// # Authz
// @included := @authz(requires: """
//  'ADMIN' IN me.roles OR
//  (this)-[:INCLUDES]->(me)
// """)
//
// @knows := @authz(requires: """
//   'ADMIN' IN me.roles OR
//   this = me OR
//   (me)-[:KNOWS]-(this)
// """)
//
// @me := @authz(requires: """
//   'ADMIN' IN me.roles OR
//   this = me
// """)
//
// @owns := @authz(requires: """
//   (me)-[:OWNS*..2]->(this) OR
//   'ADMIN' IN me.roles
// """)
//
// @verified := @authz(requires: """
//   me.verified = TRUE OR
//   'ADMIN' IN me.roles
// """)
//
// @views :=
//   @env(provides: """
//     CALL apoc.path.expandConfig(me, {
//       relationshipFilter: "<INCLUDES|OWNS>|VIEWS>|CONTAINS>",
//       minLevel: 1,
//       maxLevel: 3,
//       terminatorNodes: [this]
//     }) YIELD path
//   """)
//   @authz(requires: """
//     'ADMIN' IN me.roles OR
//     this IS NULL OR
//     this.privacyPolicy = 'PUBLIC' OR
//     length(path) > 0
//   """)
//
// @visible := @authz(requires: """
//   'ADMIN' IN me.roles OR
//   this.privacyPolicy <> 'SECRET' OR
//   (me)-[:OWNS*..2]->(this) OR
//   (this)-[:INCLUDES]->(me) OR
//   (this)-[:INVITED]->(me)
// """)
// `,
//   typeDefs: `enum Role {
//   ADMIN
//   USER
//   NONE
// }
//
// enum PrivacyPolicy {
//   PUBLIC
//   PRIVATE
//   SECRET
// }
//
// enum CollectionAccessPolicy {
//   EDIT
//   BORROW
//   VIEW
// }
//
// union UserGroup = User | Group
//
// type User @user {
//   uuid: ID! @id
//   email: String @me
//   username: String!
//   password: String @admin
//   roles: [Role!] @admin
//   collections: [Collection] @relation(name: "OWNS", direction: "OUT") @me
//   peers: [User] @relation(name: "KNOWS", direction: "OUT") @authz(requires: """
//     'ADMIN' IN me.roles OR
//     me = this OR
//     (me)-[:KNOWS*..2]-(this)
//   """)
//   peerRequestsReceived: [User] @relation(name: "REQUESTED", direction: "IN") @me
//   peerRequestsSent: [User] @relation(name: "REQUESTED", direction: "OUT") @me
//   groups: [Group] @relation(name: "INCLUDES", direction: "IN") @knows
//   groupInvites: [Group] @relation(name: "INVITED", direction: "IN") @me
//   groupRequests: [Group] @relation(name: "REQUESTED", direction: "OUT") @me
//   apps: [App] @relation(name: "OWNS", direction: "OUT") @me
//   clients: [Client] @relation(name: "OWNS", direction: "OUT") @me
//   services: [Service] @relation(name: "OWNS", direction: "OUT") @me
// }
//
// type Group @user @visible {
//   uuid: ID! @id
//   name: String!
//   description: String!
//   privacyPolicy: PrivacyPolicy!
//   owners: [User] @relation(name: "OWNS", direction: "IN") @included
//   members: [User] @relation(name: "INCLUDES", direction: "IN") @included
//   invitedUsers: [User] @relation(name: "INVITED", direction: "OUT") @included
//   rejectedUsers: [User] @relation(name: "REJECTED", direction: "OUT") @owns
//   requestedUsers: [User] @relation(name: "REQUESTED", direction: "IN") @owns
//   collections: [Collection] @relation(name: "VIEWS", direction: "OUT") @included
// }
//
// type Collection @user @views {
//   uuid: ID! @id
//   name: String!
//   description: String!
//   owner: UserGroup @relation(name: "OWNS", direction: "IN")
//   borrowers: [Collection] @relation(name: "BORROWS_FROM", direction: "IN")
//   lenders: [Collection] @relation(name: "BORROWS_FROM", direction: "OUT")
//   apps: [App] @relation(name: "CONTAINS", direction: "OUT")
//   clients: [Client] @relation(name: "CONTAINS", direction: "OUT")
//   services: [Service] @relation(name: "CONTAINS", direction: "OUT")
// }
//
// interface Client @user @views {
//   uuid: ID! @id
//   name: String
//   description: String
//   collection: Collection
//   dependencies: [Service]
//   owners: [User]
// }
//
// type App implements Client @user @views {
//   uuid: ID! @id
//   name: String
//   description: String
//   collection: Collection @relation(name: "CONTAINS", direction: "IN")
//   dependencies: [Service] @relation(name: "AFFORDS_USE_BY", direction: "IN")
//   owners: [User] @relation(name: "OWNS", direction: "IN")
// }
//
// type Service implements Client @user @views {
//   uuid: ID! @id
//   name: String
//   description: String
//   collection: Collection @relation(name: "CONTAINS", direction: "IN")
//   dependencies: [Service] @relation(name: "AFFORDS_USE_BY", direction: "IN")
//   owners: [User] @relation(name: "OWNS", direction: "IN")
//   dependents: [Client] @relation(name: "AFFORDS_USE_BY", direction: "OUT")
//   apiKey: String @owns
// }
//
// type Query @user {
//   Me: User @cypher(statement: "RETURN me")
// }
//
// query App($uuid: ID!) {
//   App(uuid: $uuid) {
//     ...appFields
//   }
// }
//
// query Client($uuid: ID!) {
//   Client(uuid: $uuid) {
//     ...clientFields
//   }
// }
//
// query Collection($uuid: ID!) {
//   Collection(uuid: $uuid) {
//     ...collectionFields
//   }
// }
//
// query Group($uuid: ID!) {
//   Group(uuid: $uuid) {
//     ...groupFields
//   }
// }
//
// query Me {
//   Me {
//     ...userFields
//   }
// }
//
// query MiniMe {
//   Me {
//     ...miniUserFields
//   }
// }
//
// query Service($uuid: ID!) {
//   Service(uuid: $uuid) {
//     ...serviceFields
//   }
// }
//
// type Mutation {
//   AcceptPeerRequest(userUUID: ID!): Boolean
//     @user
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[requested:REQUESTED]->(me)")
//     @cypher(statement: "MERGE (me)-[:KNOWS]-(user) DETACH DELETE requested RETURN TRUE")
//
//   AcceptGroupInvite(groupUUID: ID!): Boolean
//     @user
//     @env(provides: "MATCH (group:Group { uuid: $groupUUID })-[invited:INVITED]->(me)")
//     @cypher(statement: "MERGE (group)-[:INCLUDES]->(me) DETACH DELETE invited RETURN TRUE")
//
//   AcceptGroupJoinRequest(groupUUID: ID!, userUUID: ID!): Boolean
//     @user
//     @owns(this: "group")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[requested:REQUESTED]->(group:Group { uuid: $groupUUID })")
//     @cypher(statement: "MERGE (group)-[:INCLUDES]->(user) DETACH DELETE requested RETURN TRUE")
//
//   AddAppOwner(appUUID: ID!, userUUID: ID!): App
//     @user
//     @owns(this: "app")
//     @env(provides: "MATCH (app:App { uuid: $appUUID })<-[:CONTAINS]-(:Collection)<-[:VIEWS]-(:Group)-[:INCLUDES]->(user:User { uuid: $userUUID })")
//     @cypher(statement: "MERGE (user)-[:OWNS]->(app) RETURN app")
//
//   AddGroupOwner(groupUUID: ID!, userUUID: ID!): Group
//     @user
//     @owns(this: "group")
//     @authz(requires: "(user)-[:OWNS]->(group) OR (group)-[:INCLUDES]->(user)")
//     @env(provides: "MATCH (group:Group { uuid: $groupUUID }) MATCH (user:User { uuid: $userUUID })")
//     @cypher(statement: "MERGE (user)-[:OWNS]->(group) RETURN group")
//
//   AddServiceOwner(serviceUUID: ID!, userUUID: ID!): Service
//     @user
//     @owns(this: "service")
//     @env(provides: "MATCH (service:Service { uuid: $serviceUUID })<-[:CONTAINS]-(:Collection)<-[:VIEWS]-(:Group)-[:INCLUDES]->(user:User { uuid: $userUUID })")
//     @cypher(statement: "MERGE (user)-[:OWNS]->(service) RETURN service")
//
//   AffordUseByClientForService(clientUUID: ID!, serviceUUID: ID!): String
//     @user
//     @owns(this: "client")
//     @views(this: "service")
//     @authz(requires: """
//       (client)<-[:CONTAINS]-(:Collection)-[:CONTAINS]->(service) OR
//       (client)<-[:CONTAINS]-(:Collection)-[:BORROWS_FROM*]->(:Collection)-[:CONTAINS]->(service)
//     """)
//     @env(provides: "MATCH (client:Client { uuid: $clientUUID }) MATCH (service:Service { uuid: $serviceUUID })")
//     @cypher(statement: "MERGE (service)-[:AFFORDS_USE_BY { key: $apiKey }]->(client) RETURN TRUE")
//
//   BorrowFromCollection(borrowerUUID: ID!, lenderUUID: ID!): Boolean
//     @user
//     @owns(this: "borrower")
//     @views(this: "lender")
//     @env(provides: "MATCH (borrower:Collection { uuid: $borrowerUUID }) MATCH (lender:Collection { uuid: $lenderUUID })")
//     @cypher(statement: "MERGE (borrower)-[:BORROWS_FROM]->(lender) RETURN TRUE")
//
//   CreateAdmin(email: String!, password: String!, username: String!): User
//     @admin
//     @authz(requires: """
//       OPTIONAL MATCH (existingUserByEmail:User { email: $email })
//       OPTIONAL MATCH (existingUserByUsername:User { username: $username })
//       RETURN existingUserByEmail IS NULL AND existingUserByUsername IS NULL
//     """)
//     @cypher(statement: """
//       CREATE (user:User {
//         uuid: apoc.create.uuid(),
//         email: $email,
//         password: $password,
//         roles: ['ADMIN', 'USER'],
//         username: $username
//       })
//       RETURN user
//     """)
//
//   CreateApp(name: String!, description: String!, collectionUUID: ID!): App
//     @user
//     @views(this: "collection")
//     @env(provides: "MATCH (collection:Collection { uuid: $collectionUUID })")
//     @cypher(statement: """
//       CREATE (app:App:Client {
//         uuid: apoc.create.uuid(),
//         name: $name,
//         description: $description
//       }), (me)-[:OWNS]->(app), (collection)-[:CONTAINS]->(app)
//       RETURN app
//     """)
//
//   CreateCollection(name: String!, description: String!, groupUUID: ID): Collection
//     @user
//     @views(this: "group")
//     @authz(requires: "'ADMIN' IN me.roles OR $groupUUID IS NULL OR (me)-[:OWNS]->(:Group { uuid: $groupUUID })")
//     @env(provides: "OPTIONAL MATCH (group:Group { uuid: $groupUUID })")
//     @cypher(statement: """
//       CREATE (collection:Collection {
//         uuid: apoc.create.uuid(),
//         name: $name,
//         description: $description
//       })
//       WITH collection, group, me
//       CALL apoc.do.when(
//         group IS NOT NULL,
//         'CREATE (group)-[:OWNS]->(collection), (group)-[:VIEWS]->(collection) RETURN collection',
//         'CREATE (me)-[:OWNS]->(collection) RETURN collection',
//         { collection: collection, group: group, me: me }
//       ) YIELD value
//       RETURN value.collection AS collection
//     """)
//
//   CreateGroup(name: String!, description: String!, privacyPolicy: PrivacyPolicy!, userUUIDs: [ID!]): Group
//     @user
//     @knows(this: "user")
//     @env(provides: "UNWIND $userUUIDs AS userUUID MATCH (user:User { uuid: userUUID })")
//     @cypher(statement: """
//       CREATE (group:Group {
//         uuid: apoc.create.uuid(),
//         name: $name,
//         description: $description,
//         privacyPolicy: $privacyPolicy
//       }),
//         (me)-[:OWNS]->(group),
//         (group)-[:INCLUDES]->(me),
//         (group)-[invited:INVITED]->(user)
//       RETURN group
//     """)
//
//   CreateService(name: String!, description: String!, collectionUUID: ID!): Service
//     @user
//     @views(this: "collection")
//     @env(provides: "MATCH (collection:Collection { uuid: $collectionUUID })")
//     @cypher(statement: """
//       CREATE (service:Service:Client {
//         uuid: apoc.create.uuid(),
//         name: $name,
//         description: $description,
//         key: $apiKey,
//         apiKey: NULL
//       }), (me)-[:OWNS]->(service), (collection)-[:CONTAINS]->(service)
//       RETURN service
//     """)
//
//   DeleteApp(appUUID: ID!): App
//     @user
//     @owns(this: "appToDelete")
//     @env(provides: "MATCH (appToDelete:App { uuid: $appUUID })")
//     @cypher(statement: """
//       WITH appToDelete, properties(appToDelete) AS app
//       DETACH DELETE appToDelete
//       RETURN app
//     """)
//
//   DeleteCollection(collectionUUID: ID!): Collection
//     @user
//     @owns(this: "collectionToDelete")
//     @env(provides: "MATCH (collectionToDelete:App { uuid: $appUUID })")
//     @cypher(statement: """
//       WITH collectionToDelete, properties(collectionToDelete) AS collection
//       DETACH DELETE collectionToDelete
//       RETURN collection
//     """)
//
//   DeleteGroup(groupUUID: ID!): Group
//     @user
//     @owns(this: "groupToDelete")
//     @env(provides: "MATCH (groupToDelete:Group { uuid: $groupUUID })")
//     @cypher(statement: """
//       WITH groupToDelete, properties(groupToDelete) AS group
//       DETACH DELETE groupToDelete
//       RETURN group
//     """)
//
//   DeleteMe: Boolean
//     @user
//     @me
//     @cypher(statement: "DETACH DELETE me RETURN TRUE")
//
//   DeleteService(serviceUUID: ID!): Service
//     @user
//     @owns(this: "serviceToDelete")
//     @env(provides: "MATCH (serviceToDelete:Service { uuid: $serviceUUID })")
//     @cypher(statement: """
//       WITH serviceToDelete, properties(serviceToDelete) AS service
//       DETACH DELETE serviceToDelete
//       RETURN service
//     """)
//
//   DeleteUser(userUUID: ID!): User
//     @admin
//     @cypher(statement: """
//       MATCH (userToDelete:User { uuid: $userUUID })
//       WITH userToDelete, properties(userToDelete) AS user
//       DETACH DELETE userToDelete
//       RETURN user
//     """)
//
//   InvitePeersToGroup(groupUUID: ID!, userUUIDs: [ID!]!): Boolean
//     @user
//     @knows(this: "user")
//     @included(this: "group")
//     @authz(requires: "NOT ((user)-[:REJECTED]->(group) OR (group)-[:INVITED]->(user) OR (group)-[:INCLUDES]->(user))")
//     @env(provides: "MATCH (group:Group { groupUUID }) UNWIND $userUUIDs AS userUUID MATCH (user:User { uuid: userUUID })")
//     @cypher(statement: """
//       OPTIONAL MATCH (group)-[rejected:REJECTED]->(user)
//       MERGE (group)-[invited:INVITED]->(user)
//       DETACH DELETE rejected
//       RETURN TRUE
//     """)
//
//   LeaveGroup(groupUUID: ID!): Boolean
//     @user
//     @cypher(statement: """
//       MATCH (group:Group { uuid: $groupUUID })-[includes:INCLUDES]->(me)
//       DETACH DELETE includes
//       RETURN TRUE
//     """)
//
//   RefreshClientServiceAffordance(clientUUID: ID!, serviceUUID: ID!): String
//     @user
//     @owns(this: "client")
//     @env(provides: "MATCH (:Service { uuid: $serviceUUID })-[uses:AFFORDS_USE_BY]->(client:Client { uuid: $clientUUID })")
//     @cypher(statement: "SET uses.key = $apiKey RETURN TRUE")
//
//   RefreshServiceAPIKey(serviceUUID: ID!): String
//     @user
//     @owns(this: "service")
//     @env(provides: "MATCH (service:Service { uuid: $serviceUUID })")
//     @cypher(statement: "SET service.key = $apiKey RETURN TRUE")
//
//   RejectGroupInvitation(groupUUID: ID!): Boolean
//     @user
//     @cypher(statement: """
//       MATCH (group:Group { uuid: $groupUUID })-[invited:INVITED]->(me)
//       MERGE (me)-[:REJECTED]->(group)
//       DETACH DELETE invited
//       RETURN TRUE
//     """)
//
//   RejectGroupRequest(groupUUID: ID!, userUUID: ID!): Boolean
//     @user
//     @owns(this: "group")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[requested:REQUESTED]->(group:Group { uuid: $groupUUID})")
//     @cypher(statement: "MERGE (group)-[:REJECTED]->(user) DETACH DELETE requested RETURN TRUE")
//
//   RejectPeerRequest(userUUID: ID!): Boolean
//     @user
//     @cypher(statement: """
//       MATCH (user:User { uuid: $userUUID })-[requested:REQUESTED]->(me)
//       MERGE (me)-[:REJECTED]->(user)
//       DETACH DELETE requested
//       RETURN TRUE
//     """)
//
//   RemoveAppOwner(appUUID: ID!, userUUID: ID!): App
//     @user
//     @owns(this: "app")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[owns:OWNS]->(app:App { uuid: $appUUID })")
//     @cypher(statement: "DETACH DELETE owns RETURN app")
//
//   RemoveGroupOwner(groupUUID: ID!, userUUID: ID!): Group
//     @user
//     @owns(this: "group")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[owns:OWNS]->(group:Group { uuid: $groupUUID })")
//     @cypher(statement: "DETACH DELETE owns RETURN group")
//
//   RemoveServiceOwner(serviceUUID: ID!, userUUID: ID!): Service
//     @user
//     @owns(this: "service")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })-[owns:OWNS]->(service:Service { uuid: $serviceUUID })")
//     @cypher(statement: "DETACH DELETE owns RETURN service")
//
//   RequestGroup(groupUUID: ID!): Boolean
//     @user
//     @authz(requires: "NOT ((group)-[:REJECTED]->(me) OR (group)-[:INVITED]->(me) OR (group)-[:INCLUDES]->(me))")
//     @env(provides: "MATCH (group:Group { uuid: $groupUUID })")
//     @cypher(statement: """
//       OPTIONAL MATCH (me)-[rejected:REJECTED]->(group)
//       MERGE (me)-[:REQUESTED]->(group)
//       DETACH DELETE rejected
//       RETURN TRUE
//     """)
//
//   RequestPeer(userUUID: ID!): Boolean
//     @user
//     @authz(requires: "NOT ((user)-[:REJECTED]->(me) OR (user)-[:REQUESTED]->(me) OR (user)-[:KNOWS]-(me))")
//     @env(provides: "MATCH (user:User { uuid: $userUUID })")
//     @cypher(statement: """
//       OPTIONAL MATCH (me)-[rejected:REJECTED]->(user)
//       MERGE (me)-[:REQUESTED]->(user)
//       DETACH DELETE rejected
//       RETURN TRUE
//     """)
//
//   ShareCollectionWithGroup(collectionUUID: ID!, groupUUID: ID!): Boolean
//     @user
//     @owns(this: "collection")
//     @included(this: "group")
//     @authz(requires: "NOT (:Group)-[:VIEWS]->(collection)")
//     @env(provides: "MATCH (collection:Collection { uuid: $collectionUUID }) MATCH (group:Group { uuid: $groupUUID })")
//     @cypher(statement: "MERGE (group)-[:VIEWS]->(collection) RETURN TRUE")
//
//   SignIn(email: String!, password: String!): User
//
//   SignOut: Boolean
//
//   SignUp(email: String!, password: String!, username: String!): User
//     @authz(requires: """
//       OPTIONAL MATCH (existingUserByEmail:User { email: $email })
//       OPTIONAL MATCH (existingUserByUsername:User { username: $username })
//       RETURN existingUserByEmail IS NULL AND existingUserByUsername IS NULL
//     """)
//     @cypher(statement: """
//       CREATE (user:User {
//         uuid: apoc.create.uuid(),
//         email: $email,
//         password: $password,
//         roles: ['USER'],
//         username: $username
//       })
//       RETURN user
//     """)
//
//   UnborrowFromCollection(borrowerUUID: ID!, collectionUUID: ID!): Boolean
//     @user
//     @owns(this: "borrower")
//     @env(provides: "MATCH (:Collection { uuid: $borrowerUUID })-[borrowing:BORROWS_FROM]->(:Collection { uuid: $collectionUUID })")
//     @cypher(statement: "DETACH DELETE borrowing RETURN TRUE")
//
//   UnshareCollectionFromGroup(collectionUUID: ID!, groupUUID: ID!): Boolean
//     @user
//     @owns(this: "collection")
//     @env(provides: "MATCH (group:Group { uuid: $groupUUID })-[views:VIEWS]->(collection:Collection { uuid: $collectionUUID })")
//     @cypher(statement: """
//       OPTIONAL MATCH (group)-[:OWNS]->(groupCollection:Collection)-[borrowing1:BORROWS_FROM]-(collection)
//       OPTIONAL MATCH (group)-[:VIEWS]->(memberCollection:Collection)-[borrowing2:BORROWS_FROM]-(collection)
//         WHERE NOT (memberCollection)<-[:OWNS]-(:User)-[:OWNS]->(collection)
//
//       OPTIONAL MATCH (collection)-[:CONTAINS]->(:Client)-[affordance1:AFFORDS_USE_BY]-(:Client)<-[:CONTAINS]-(groupCollection)
//       OPTIONAL MATCH (collection)-[:CONTAINS]->(:Client)-[affordance2:AFFORDS_USE_BY]-(:Client)<-[:CONTAINS]-(memberCollection)
//
//       DETACH DELETE affordance1, affordance2, borrowing1, borrowing2, views
//       RETURN TRUE
//     """)
//
//   UpdateApp(appUUID: ID!, name: String, description: String): App
//     @user
//     @owns(this: "app")
//     @env(provides: "MATCH (app:App { uuid: $appUUID })")
//     @cypher(statement: """
//       SET app.description = CASE WHEN $description IS NOT NULL THEN $description ELSE app.description END
//       SET app.name = CASE WHEN $name IS NOT NULL THEN $name ELSE app.name END
//       RETURN app
//     """)
//
//   UpdateCollection(collectionUUID: ID!, name: String, description: String): Collection
//     @user
//     @owns(this: "collection")
//     @env(provides: "MATCH (collection:Collection { uuid: $collectionUUID })")
//     @cypher(statement: """
//       WITH collection, collection.privacyPolicy AS oldPrivacyPolicy
//       SET collection.description = CASE WHEN $description IS NOT NULL THEN $description ELSE collection.description END
//       SET collection.name = CASE WHEN $name IS NOT NULL THEN $name ELSE collection.name END
//       RETURN collection
//     """)
//
//   UpdateGroup(groupUUID: ID!, name: String, description: String, privacyPolicy: PrivacyPolicy): Group
//     @user
//     @owns(this: "group")
//     @env(provides: "MATCH (group:Group { uuid: $groupUUID })")
//     @cypher(statement: """
//       SET group.description = CASE WHEN $description IS NOT NULL THEN $description ELSE group.description END
//       SET group.name = CASE WHEN $name IS NOT NULL THEN $name ELSE group.name END
//       SET group.privacyPolicy = CASE WHEN $privacyPolicy IS NOT NULL THEN $privacyPolicy ELSE group.privacyPolicy END
//       RETURN group
//     """)
//
//   UpdateService(serviceUUID: ID!, name: String, description: String): Service
//     @user
//     @owns(this: "service")
//     @env(provides: "MATCH (service:Service { uuid: $serviceUUID })")
//     @cypher(statement: """
//       SET service.description = CASE WHEN $description IS NOT NULL THEN $description ELSE service.description END
//       SET service.name = CASE WHEN $name IS NOT NULL THEN $name ELSE service.name END
//       RETURN service
//     """)
// }
//
// mutation AcceptPeerRequest($userUUID: ID!) {
//   AcceptPeerRequest(userUUID: $userUUID)
// }
//
// mutation AcceptGroupInvite($groupUUID: ID!) {
//   AcceptGroupInvite(groupUUID: $groupUUID)
// }
//
// mutation AcceptGroupJoinRequest($groupUUID: ID!, $userUUID: ID!) {
//   AcceptGroupJoinRequest(groupUUID: $groupUUID, userUUID: $userUUID)
// }
//
// mutation AddAppOwner($appUUID: ID!, $userUUID: ID!) {
//   AddAppOwner(appUUID: $appUUID, userUUID: $userUUID) {
//     ...miniAppFields
//   }
// }
//
// mutation AddGroupOwner($groupUUID: ID!, $userUUID: ID!) {
//   AddGroupOwner(groupUUID: $groupUUID, userUUID: $userUUID) {
//     ...miniGroupFields
//   }
// }
//
// mutation AddServiceOwner($serviceUUID: ID!, $userUUID: ID!) {
//   AddServiceOwner(serviceUUID: $serviceUUID, userUUID: $userUUID) {
//     ...miniServiceFields
//   }
// }
//
// mutation AffordUseByClientForService($clientUUID: ID!, $serviceUUID: ID!) {
//   AffordUseByClientForService(clientUUID: $clientUUID, serviceUUID: $serviceUUID)
// }
//
// mutation BorrowFromCollection($borrowerUUID: ID!, $collectionUUID: ID!) {
//   BorrowFromCollection(borrowerUUID: $borrowerUUID, collectionUUID: $collectionUUID)
// }
//
// mutation CreateAdmin($email: String!, $password: String!, $username: String!) {
//   CreateAdmin(email: $email, password: $password, username: $username) {
//     ...miniUserFields
//   }
// }
//
// mutation CreateApp($name: String!, $description: String!, $collectionUUID: ID!) {
//   CreateApp(name: $name, description: $description, collectionUUID: $collectionUUID) {
//     ...miniAppFields
//   }
// }
//
// mutation CreateCollection($name: String!, $description: String!, $groupUUID: ID) {
//   CreateCollection(name: $name, description: $description, groupUUID: $groupUUID) {
//     ...miniCollectionFields
//   }
// }
//
// mutation CreateGroup($name: String!, $description: String!, $privacyPolicy: PrivacyPolicy!, $userUUIDs: [ID!]) {
//   CreateGroup(name: $name, description: $description, privacyPolicy: $privacyPolicy, userUUIDs: $userUUIDs) {
//     ...miniGroupFields
//   }
// }
//
// mutation CreateService($name: String!, $description: String!, $collectionUUID: ID!) {
//   CreateService(name: $name, description: $description, collectionUUID: $collectionUUID) {
//     ...miniServiceFields
//     apiKey
//   }
// }
//
// mutation DeleteApp($appUUID: ID!) {
//   DeleteApp(appUUID: $appUUID) {
//     ...miniAppFields
//   }
// }
//
// mutation DeleteCollection($collectionUUID: ID!) {
//   DeleteCollection(collectionUUID: $collectionUUID) {
//     ...miniCollectionFields
//   }
// }
//
// mutation DeleteGroup($groupUUID: ID!) {
//   DeleteGroup(groupUUID: $groupUUID) {
//     ...miniGroupFields
//   }
// }
//
// mutation DeleteMe {
//   DeleteMe
// }
//
// mutation DeleteService($serviceUUID: ID!) {
//   DeleteService(serviceUUID: $serviceUUID) {
//     ...miniServiceFields
//   }
// }
//
// mutation DeleteUser($userUUID: ID!) {
//   DeleteUser(userUUID: $userUUID) {
//     ...miniUserFields
//   }
// }
//
// mutation InvitePeersToGroup($groupUUID: ID!, $userUUIDs: [ID!]!) {
//   InvitePeersToGroup(groupUUID: $groupUUID, userUUIDs: $userUUIDs)
// }
//
// mutation LeaveGroup($groupUUID: ID!) {
//   LeaveGroup(groupUUID: $groupUUID)
// }
//
// mutation RefreshClientServiceAffordance($clientUUID: ID!, $serviceUUID: ID!) {
//   RefreshClientServiceAffordance(clientUUID: $clientUUID, serviceUUID: $serviceUUID)
// }
//
// mutation RefreshServiceAPIKey($serviceUUID: ID!) {
//   RefreshServiceAPIKey(serviceUUID: $serviceUUID)
// }
//
// mutation RejectGroupRequest($groupUUID: ID!, $userUUID: ID!) {
//   RejectGroupRequest(groupUUID: $groupUUID, userUUID: $userUUID)
// }
//
// mutation RejectPeerRequest($userUUID: ID!) {
//   RejectPeerRequest(userUUID: $userUUID)
// }
//
// mutation RemoveAppOwner($appUUID: ID!, $userUUID: ID!) {
//   RemoveAppOwner(appUUID: $appUUID, userUUID: $userUUID) {
//     ...miniAppFields
//   }
// }
//
// mutation RemoveGroupOwner($groupUUID: ID!, $userUUID: ID!) {
//   RemoveGroupOwner(groupUUID: $groupUUID, userUUID: $userUUID) {
//     ...miniGroupFields
//   }
// }
//
// mutation RemoveServiceOwner($serviceUUID: ID!, $userUUID: ID!) {
//   RemoveServiceOwner(serviceUUID: $serviceUUID, userUUID: $userUUID) {
//     ...miniServiceFields
//   }
// }
//
// mutation RequestGroup($groupUUID: ID!) {
//   RequestGroup(groupUUID: $groupUUID)
// }
//
// mutation RequestPeer($userUUID: ID!) {
//   RequestPeer(userUUID: $userUUID)
// }
//
// mutation ShareCollectionWithGroup($collectionUUID: ID!, $groupUUID: ID!) {
//   ShareCollectionWithGroup(collectionUUID: $collectionUUID, groupUUID: $groupUUID)
// }
//
// mutation SignIn($email: String!, $password: String!) {
//   SignIn(email: $email, password: $password) {
//     ...miniUserFields
//   }
// }
//
// mutation SignOut {
//   SignOut
// }
//
// mutation SignUp($email: String!, $password: String!, $username: String!) {
//   SignUp(email: $email, password: $password, username: $username) {
//     ...miniUserFields
//   }
// }
//
// mutation UnborrowFromCollection($borrowerUUID: ID!, $collectionUUID: ID!) {
//   UnborrowFromCollection(borrowerUUID: $borrowerUUID, collectionUUID: $collectionUUID)
// }
//
// mutation UnshareCollectionFromGroup($collectionUUID: ID!, $groupUUID: ID!) {
//   UnshareCollectionFromGroup(collectionUUID: $collectionUUID, groupUUID: $groupUUID)
// }
//
// mutation UpdateApp($appUUID: ID!, $name: String, $description: String) {
//   UpdateApp(appUUID: $appUUID, name: $name, description: $description) {
//     ...miniAppFields
//   }
// }
//
// mutation UpdateCollection($collectionUUID: ID!, $name: String, $description: String) {
//   UpdateCollection(collectionUUID: $collectionUUID, name: $name, description: $description) {
//     ...miniCollectionFields
//   }
// }
//
// mutation UpdateGroup($groupUUID: ID!, $name: String, $description: String, $privacyPolicy: PrivacyPolicy) {
//   UpdateGroup(groupUUID: $groupUUID, name: $name, description: $description, privacyPolicy: $privacyPolicy) {
//     ...miniGroupFields
//   }
// }
//
// mutation UpdateService($serviceUUID: ID!, $name: String, $description: String) {
//   UpdateService(serviceUUID: $serviceUUID, name: $name, description: $description) {
//     ...miniServiceFields
//   }
// }
// `,
// };
