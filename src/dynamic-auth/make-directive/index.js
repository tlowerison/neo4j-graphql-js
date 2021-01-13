import { GraphQLDirective } from 'graphql';
import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { fromPairs, has, map } from 'ramda';
import * as env from './env';
import * as filter from './filter';
import * as roles from './permissions/roles';
import * as scopes from './permissions/scopes';
import * as shield from './shield';

export const directiveDefinitions = {
  [env.definition.name]: env.definition,
  [filter.definition.name]: filter.definition,
  [roles.definition.name]: roles.definition,
  [scopes.definition.name]: scopes.definition,
  [shield.definition.name]: shield.definition
};

export const makeDirectives = {
  [env.definition.name]: env.makeDirective,
  [filter.definition.name]: filter.makeDirective,
  [roles.definition.name]: roles.makeDirective,
  [scopes.definition.name]: scopes.makeDirective,
  [shield.definition.name]: shield.makeDirective
};

const bindDirectiveInstance = (directiveInstance, THIS) =>
  map(fn => fn.bind(THIS), directiveInstance);

export const makeDirective = (
  { instances, locations, params },
  name,
  context = {},
  options = {}
) => {
  return class DirectiveVisitor extends SchemaDirectiveVisitor {
    constructor(...args) {
      super(...args);
      const baseName = name.split('_N')[0];
      if (has(name, makeDirectives)) {
        this.directiveInstances = [
          makeDirectives[name](
            baseName,
            {},
            { ...context, isDefault: true },
            directiveDefinitions[name]
          )
        ];
      } else {
        this.directiveInstances = instances.map(
          ({ name: directiveName, args }) =>
            makeDirectives[directiveName](
              baseName,
              args,
              context,
              directiveDefinitions[directiveName]
            )
        );
      }
      this.directiveInstances = this.directiveInstances.map(directiveInstance =>
        bindDirectiveInstance(directiveInstance, this)
      );
    }

    static getDirectiveDeclaration(_directiveName, schema) {
      return new GraphQLDirective({
        name,
        locations,
        args: fromPairs(
          params
            .map(({ name, type: { defaultValue, getType, getTypeName } }) => [
              name,
              {
                defaultValue,
                type: getType(
                  schema,
                  getTypeName ? getTypeName(options) : undefined
                )
              }
            ])
            .filter(([, { type }]) => Boolean(type))
        )
      });
    }

    visitFieldDefinition(...args) {
      for (let i = 0; i < this.directiveInstances.length; i += 1) {
        const directiveInstance = this.directiveInstances[i];
        if (has('visitFieldDefinition', directiveInstance)) {
          directiveInstance.visitFieldDefinition.call(this, ...args);
        }
      }
    }

    visitInterface(...args) {
      for (let i = 0; i < this.directiveInstances.length; i += 1) {
        const directiveInstance = this.directiveInstances[i];
        if (has('visitInterface', directiveInstance)) {
          directiveInstance.visitInterface.call(this, ...args);
        }
      }
    }

    visitObject(...args) {
      for (let i = 0; i < this.directiveInstances.length; i += 1) {
        const directiveInstance = this.directiveInstances[i];
        if (has('visitObject', directiveInstance)) {
          directiveInstance.visitObject.call(this, ...args);
        }
      }
    }

    visitUnion(...args) {
      for (let i = 0; i < this.directiveInstances.length; i += 1) {
        const directiveInstance = this.directiveInstances[i];
        if (has('visitUnion', directiveInstance)) {
          directiveInstance.visitUnion.call(this, ...args);
        }
      }
    }
  };
};
