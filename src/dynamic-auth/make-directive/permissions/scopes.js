import { baseDefinition } from './base-definition';
import { baseMakeDirective } from './base-make-directive';

export const definition = {
  ...baseDefinition,
  name: 'scopes'
};

export const makeDirective = (...args) => baseMakeDirective(...args);
