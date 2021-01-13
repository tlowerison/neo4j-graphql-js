import { has } from 'ramda';
import { getPermissionArgs, visitWithPermissions } from './constants';

export const baseMakeDirective = (
  name,
  args,
  { authorizations = {} },
  definition
) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName, resolve } = field;
    const permissionArgs = getPermissionArgs({
      all: args.all || this.args.all,
      any: args.any || this.args.any,
      none: args.none || this.args.none,
      notAll: args.notAll || this.args.notAll
    });
    if (permissionArgs.length !== 1) {
      throw new Error(
        `@${definition.name} must be provided exactly one argument`
      );
    }
    const [{ operation, values }] = permissionArgs;
    if (values.length === 0) {
      console.warn(
        `@${definition.name} ignores empty array arguments (i.e. @${definition.name}(${operation}: []) creates no authorization rule)`
      );
    } else {
      field.resolve = visitWithPermissions(
        parentName,
        fieldName,
        resolve,
        { type: definition.name, operation, values },
        true
      );
    }
  },
  visitInterface(interfaceType) {
    const { name: typeName } = interfaceType;
    const permissionArgs = getPermissionArgs({
      all: args.all || this.args.all,
      any: args.any || this.args.any,
      none: args.none || this.args.none,
      notAll: args.notAll || this.args.notAll
    });
    if (permissionArgs.length !== 1) {
      throw new Error(
        `@${definition.name} must be provided exactly one argument`
      );
    }
    const [{ operation, values }] = permissionArgs;
    if (values.length === 0) {
      console.warn(
        `@${definition.name} ignores empty array arguments (i.e. @${definition.name}(${operation}: []) creates no authorization rule)`
      );
    } else {
      Object.values(interfaceType.getFields()).forEach(
        field =>
          (field.resolve = visitWithPermissions(
            typeName,
            field.name,
            field.resolve,
            { type: definition.name, operation, values },
            false
          ))
      );
    }
  },
  visitObject(objectType) {
    const { name: typeName } = objectType;
    const permissionArgs = getPermissionArgs({
      all: args.all || this.args.all,
      any: args.any || this.args.any,
      none: args.none || this.args.none,
      notAll: args.notAll || this.args.notAll
    });
    if (permissionArgs.length !== 1) {
      throw new Error(
        `@${definition.name} must be provided exactly one argument`
      );
    }
    const [{ operation, values }] = permissionArgs;
    if (values.length === 0) {
      console.warn(
        `@${definition.name} ignores empty array arguments (i.e. @${definition.name}(${operation}: []) creates no authorization rule)`
      );
    } else {
      Object.values(objectType.getFields()).forEach(
        field =>
          (field.resolve = visitWithPermissions(
            typeName,
            field.name,
            field.resolve,
            { type: definition.name, operation, values },
            false
          ))
      );
    }
  }
});
