import { defaultFieldResolver } from 'graphql';
import { intersection } from 'ramda';

export const AUTHENTICATION_NAME = 'authn';

const visit = (resolver, requires) =>
  async function(root, params, context, info) {
    const userRoles = context.session?.me?.roles;
    if (!userRoles || intersection(requires, userRoles).length === 0)
      return null;
    const data = await resolver.call(this, root, params, context, info);
    return data;
  };

export const makeAuthenticationDirective = (name, args) => ({
  visitFieldDefinition(field) {
    const { resolve = defaultFieldResolver } = field;
    field.resolve = async function(root, params, context, info) {
      const userRoles = context.session?.me?.roles;
      if (
        !userRoles ||
        intersection(args.requires || this.args.requires, userRoles).length ===
          0
      )
        return null;
      const data = await resolve.call(this, root, params, context, info);
      return data;
    };
  },
  visitInterface(interfaceType) {
    const { resolveInterface } = interfaceType;
    if (resolveInterface) {
      interfaceType.resolveInterface = visit(
        resolveInterface,
        args.requires || this.args.requires
      );
    }
  },
  visitObject(objectType) {
    const { resolveObject } = objectType;
    if (resolveObject) {
      objectType.resolveObject = visit(
        resolveObject,
        args.requires || this.args.requires
      );
    }
  },
  visitUnion(unionType) {
    const { resolveUnion } = unionType;
    if (resolveUnion) {
      unionType.resolveUnion = visit(
        resolveUnion,
        args.requires || this.args.requires
      );
    }
  }
});
