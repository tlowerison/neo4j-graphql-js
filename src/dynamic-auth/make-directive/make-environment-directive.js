import { has } from 'ramda';

export const ENVIRONMENT_NAME = 'env';

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
