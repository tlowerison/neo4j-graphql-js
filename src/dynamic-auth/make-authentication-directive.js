import { DirectiveLocation, GraphQLDirective, GraphQLList } from 'graphql';
import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { defaultFieldResolver } from 'graphql';
import { intersection } from 'ramda';

const visit = (resolver, requires) =>
  async function(root, params, context, info) {
    const userRoles = context.session?.me?.roles;
    if (!userRoles || intersection(requires, userRoles).length === 0)
      return null;
    const data = await resolver.call(this, root, params, context, info);
    return data;
  };

export const makeAuthenticationDirective = (name = 'authn', requires) =>
  class AuthenticationDirective extends SchemaDirectiveVisitor {
    static getDirectiveDeclaration(_directiveName, schema) {
      const RoleType = schema.getType('Role');
      if (!RoleType) {
        throw new Error('Role enum is required');
      }
      return new GraphQLDirective({
        name,
        locations: [
          DirectiveLocation.FIELD_DEFINITION,
          DirectiveLocation.INTERFACE,
          DirectiveLocation.OBJECT,
          DirectiveLocation.UNION
        ],
        args: {
          requires: {
            type: new GraphQLList(RoleType),
            defaultValue: 'NONE'
          }
        }
      });
    }

    visitFieldDefinition(field) {
      const { resolve = defaultFieldResolver } = field;
      field.resolve = async function(root, params, context, info) {
        const userRoles = context.session?.me?.roles;
        if (
          !userRoles ||
          intersection(requires || this.args.requires, userRoles).length === 0
        )
          return null;
        const data = await resolve.call(this, root, params, context, info);
        return data;
      };
    }

    visitInterface(interfaceType) {
      const { resolveInterface } = interfaceType;
      if (resolveInterface) {
        interfaceType.resolveInterface = visit(
          resolveInterface,
          requires || this.args.requires
        );
      }
    }

    visitObject(objectType) {
      const { resolveObject } = objectType;
      if (resolveObject) {
        objectType.resolveObject = visit(
          resolveObject,
          requires || this.args.requires
        );
      }
    }

    visitUnion(unionType) {
      const { resolveUnion } = unionType;
      if (resolveUnion) {
        unionType.resolveUnion = visit(
          resolveUnion,
          requires || this.args.requires
        );
      }
    }
  };
