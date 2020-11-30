import {
  DirectiveLocation,
  GraphQLDirective,
  GraphQLList,
  GraphQLString
} from 'graphql';
import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { has } from 'ramda';
import { typeIdentifiers } from '../utils';

export const makeEnvironmentDirective = (provisions, name = 'env', provides) =>
  class EnvironmentDirective extends SchemaDirectiveVisitor {
    static getDirectiveDeclaration() {
      return new GraphQLDirective({
        name,
        locations: [DirectiveLocation.FIELD_DEFINITION],
        args: {
          provides: {
            type: GraphQLString,
            defaultValue: ''
          }
        }
      });
    }

    visitFieldDefinition(field, details) {
      const parentName = details.objectType.name;
      if (!(parentName === 'Query' || parentName === 'Mutation')) {
        return;
      }
      const { name: fieldName } = field;
      const { typeName } = typeIdentifiers(field.type);
      if (!has(parentName, provisions)) {
        provisions[parentName] = {};
      }
      if (!has(fieldName, provisions[parentName])) {
        provisions[parentName][fieldName] = [];
      }
      provisions[parentName][fieldName].push(provides || this.args.provides);
    }
  };
