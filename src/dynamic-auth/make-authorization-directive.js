import {
  DirectiveLocation,
  GraphQLDirective,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { has } from 'ramda';
import { typeIdentifiers } from '../utils';

const toAuthorization = requires => variableName =>
  `(${requires.replace(new RegExp('this', 'g'), variableName)})`;
const saveNodeAuthorization = ({ authorizations, requires, typeName }) => {
  if (!has(typeName, authorizations)) {
    authorizations[typeName] = {
      fields: {},
      node: []
    };
  }
  authorizations[typeName].node.push(toAuthorization(requires));
};

export const makeAuthorizationDirective = (name, authorizations, requires) =>
  class AuthorizationDirective extends SchemaDirectiveVisitor {
    static getDirectiveDeclaration() {
      return new GraphQLDirective({
        name,
        locations: [DirectiveLocation.FIELD_DEFINITION],
        args: {
          fields: {
            type: new GraphQLList(GraphQLString),
            defaultValue: []
          },
          requires: {
            type: GraphQLString,
            defaultValue: 'FALSE'
          }
        }
      });
    }

    visitFieldDefinition(field, details) {
      const parentName = details.objectType.name;
      const { name: fieldName } = field;
      const { typeName } = typeIdentifiers(field.type);
      if (!has(typeName, authorizations)) {
        authorizations[typeName] = {
          fields: {},
          node: []
        };
      }
      if (!has(fieldName, authorizations[typeName].fields)) {
        authorizations[typeName].fields[fieldName] = {};
      }
      if (!has(parentName, authorizations[typeName].fields[fieldName])) {
        authorizations[typeName].fields[fieldName][parentName] = [];
      }
      authorizations[typeName].fields[fieldName][parentName].push(
        toAuthorization(requires || this.args.requires)
      );
    }

    visitInterface({ name: typeName }) {
      saveNodeAuthorization({
        authorizations,
        requires: requires || this.args.requires,
        typeName
      });
    }

    visitObject({ name: typeName }) {
      saveNodeAuthorization({
        authorizations,
        requires: requires || this.args.requires,
        typeName
      });
    }

    visitUnion({ name: typeName }) {
      saveNodeAuthorization({
        authorizations,
        requires: requires || this.args.requires,
        typeName
      });
    }
  };
