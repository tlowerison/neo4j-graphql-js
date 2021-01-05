import {
  AUTHORIZATION_DIRECTIVE,
  AUTHORIZATION_NAME,
  makeAuthorizationDirective
} from './make-authorization-directive';
import {
  ENVIRONMENT_DIRECTIVE,
  ENVIRONMENT_NAME,
  makeEnvironmentDirective
} from './make-environment-directive';
import { GraphQLDirective } from 'graphql';

import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { fromPairs, has, map } from 'ramda';

export * from './make-authorization-directive';
export * from './make-environment-directive';

export const directives = {
  [AUTHORIZATION_NAME]: AUTHORIZATION_DIRECTIVE,
  [ENVIRONMENT_NAME]: ENVIRONMENT_DIRECTIVE
};

const makeDirectives = {
  [AUTHORIZATION_NAME]: makeAuthorizationDirective,
  [ENVIRONMENT_NAME]: makeEnvironmentDirective
};

const bindDirectiveInstance = (directiveInstance, THIS) =>
  map(fn => fn.bind(THIS), directiveInstance);

export const makeDirective = (
  { instances, locations, params },
  name,
  context = {}
) =>
  class DirectiveVisitor extends SchemaDirectiveVisitor {
    constructor(config) {
      super(config);
      if (has(name, makeDirectives)) {
        this.directiveInstances = [
          makeDirectives[name](name, {}, { ...context, isDefault: true })
        ];
      } else {
        this.directiveInstances = instances.map(
          ({ name: directiveName, args }) =>
            makeDirectives[directiveName](name, args, context)
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
          params.map(({ name, type: { defaultValue, getType } }) => [
            name,
            { defaultValue, type: getType(schema) }
          ])
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
