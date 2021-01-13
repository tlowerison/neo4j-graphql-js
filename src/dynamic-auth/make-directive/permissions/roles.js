import { baseDefinition } from './base-definition';
import { baseMakeDirective } from './base-make-directive';

export const definition = {
  ...baseDefinition,
  name: 'roles'
};

export const makeDirective = (...args) => baseMakeDirective(...args);
