import { DirectiveLocation, GraphQLList } from 'graphql';
import { defaultFieldResolver } from 'graphql';
import { intersection } from 'ramda';

export const AUTHENTICATION_NAME = 'authn';
export const AUTHENTICATION_DIRECTIVE = {
  customParams: [],
  instances: [],
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.INTERFACE,
    DirectiveLocation.OBJECT,
    DirectiveLocation.UNION
  ],
  params: [
    {
      name: 'requires',
      transform: value => value.split(',').map(role => role.trim()),
      type: {
        getDefinition: schema => {
          const RoleType = schema.getType('Role');
          if (!RoleType) {
            throw new Error('Role enum is required');
          }
          return { type: new GraphQLList(RoleType), defaultValue: 'NONE' };
        },
        value: '[Role!]!'
      },
      wrappers: [{ left: '[', right: ']' }]
    }
  ]
};

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
