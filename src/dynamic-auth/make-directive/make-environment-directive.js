import { DirectiveLocation, GraphQLNonNull, GraphQLString } from 'graphql';
import { has } from 'ramda';

export const ENVIRONMENT_NAME = 'env';
export const ENVIRONMENT_DIRECTIVE = {
  customParams: [
    {
      name: 'this',
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ],
  instances: [],
  locations: [DirectiveLocation.FIELD_DEFINITION],
  params: [
    {
      name: 'provides',
      type: {
        defaultValue: '',
        getType: () => new GraphQLNonNull(GraphQLString),
        getTypeDef: () => 'String!',
        getTypeName: () => 'String!'
      },
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ]
};

export const makeEnvironmentDirective = (
  name,
  args,
  { environments = {}, isDefault = false }
) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    if (!(parentName === 'Query' || parentName === 'Mutation')) {
      return;
    }
    const { name: fieldName } = field;
    if (!has(parentName, environments)) {
      environments[parentName] = {};
    }
    if (!has(fieldName, environments[parentName])) {
      environments[parentName][fieldName] = [];
    }
    if (isDefault) {
      environments[parentName][fieldName].unshift(
        args.provides || this.args.provides
      );
    } else {
      environments[parentName][fieldName].push(
        args.provides || this.args.provides
      );
    }
  }
});
