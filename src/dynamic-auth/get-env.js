import { alpha, alphanumeric } from './to-make-augmented-schema';

export const getEnv = ({ context, resolveInfo }) => {
  const typeName = resolveInfo.parentType.name;
  const env =
    context.environments &&
    context.environments[typeName] &&
    context.environments[typeName][resolveInfo.fieldName]
      ? `${context.environments[typeName][resolveInfo.fieldName].join(' ')} `
      : '';
  const varNames =
    env.match(new RegExp(`(?<=\\()${alpha}${alphanumeric}+(?=:)`, 'g')) || [];
  return { env, varNames: ['me', ...varNames] };
};
