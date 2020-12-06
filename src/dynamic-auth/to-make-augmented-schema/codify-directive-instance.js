import { sortBy, toPairs } from 'ramda';

export const codifyDirectiveInstance = ({ name, args }) =>
  [
    name,
    sortBy(({ name }) => name, toPairs(args))
      .map(
        ([name, value]) =>
          `${name}_V_${value
            .split('')
            .map(e => e.charCodeAt(0))
            .join('_')}`
      )
      .join('_A_')
  ]
    .filter(e => e.length > 0)
    .join('_N_');
