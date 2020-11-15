import { DirectiveLocation, GraphQLDirective, GraphQLList } from 'graphql';
import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { defaultFieldResolver } from 'graphql';
import { intersection } from 'ramda';

export class AuthenticationDirective extends SchemaDirectiveVisitor {
  static getDirectiveDeclaration(_directiveName, schema) {
    const RoleType = schema.getType('Role');
    if (!RoleType) {
      throw new Error('Role enum is required');
    }
    return new GraphQLDirective({
      name: 'authn',
      locations: [DirectiveLocation.FIELD_DEFINITION, DirectiveLocation.OBJECT],
      args: {
        requires: {
          type: new GraphQLList(RoleType),
          defaultValue: 'NONE'
        }
      }
    });
  }

  visitFieldDefinition(field) {
    const requires = this.args.requires;
    const { resolve = defaultFieldResolver } = field;
    field.resolve = async function(root, params, context, info) {
      const userRoles = context.session?.me?.roles;
      if (!userRoles || intersection(requires, userRoles).length === 0)
        return null;
      const data = await resolve.call(this, root, params, context, info);
      return data;
    };
  }

  visitObject(objectType) {
    const requires = this.args.requires;
    const { resolveObject } = objectType;
    if (resolveObject) {
      objectType.resolveObject = async function(root, params, context, info) {
        const userRoles = context.session?.me?.roles;
        if (!userRoles || intersection(requires, userRoles).length === 0)
          return null;
        const data = await resolveObject.call(
          this,
          root,
          params,
          context,
          info
        );
        return data;
      };
    }
  }
}
