import { alphanumeric } from './constants';
import { directiveDefinitions } from '../make-directive';
import { intersection, map } from 'ramda';

export const decodifyDirectiveInstance = (
  codifiedDirectiveInstance,
  customDirectives
) => {
  const [name, args] = codifiedDirectiveInstance.split('_N_');
  const allArgs = !args
    ? []
    : args
        .split('_A_')
        .map(arg => arg.split('_V_'))
        .map(([name, value]) => ({
          name,
          value: value
            .split('_')
            .map(c => String.fromCharCode(c))
            .join('')
        }));
  return {
    customParams: [],
    instances: customDirectives[name].instances.map(({ args, name }) => ({
      name,
      args: map(
        arg =>
          typeof arg !== 'string'
            ? arg
            : allArgs.reduce(
                (acc, { name, value }) =>
                  // TODO (tlowerison): Make customParam subsitution generic per directive argument and defined by
                  // argument type (currently only support customParam substitution for GraphQLString directive arguments)
                  acc
                    .replace(
                      new RegExp(
                        `(?<!${alphanumeric})${name}(?!${alphanumeric})`,
                        'g'
                      ),
                      value
                    )
                    .replace(new RegExp('( |\t|\n)+', 'g'), ' ')
                    .trim(),
                arg
              ),
        args
      )
    })),
    locations: customDirectives[name].instances
      .map(({ name }) => directiveDefinitions[name].locations)
      .reduce((acc, locations) => intersection(acc, locations)),
    params: []
  };
};
