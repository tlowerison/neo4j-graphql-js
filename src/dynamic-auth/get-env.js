import { varName } from './to-make-augmented-schema';

export const getEnv = ({ context, resolveInfo }) => {
  const typeName = resolveInfo.parentType.name;
  const env =
    context.environments &&
    context.environments[typeName] &&
    context.environments[typeName][resolveInfo.fieldName]
      ? `${context.environments[typeName][resolveInfo.fieldName].join(' ')} `
      : '';
  const varNames = [
    ...(env.match(new RegExp(`(?<=\\()${varName}(?=:)`, 'g')) || []),
    ...(
      env.match(
        new RegExp(`(?<=( |\t|\n)[Aa][Ss])( |\t|\n)+${varName}`, 'g')
      ) || []
    ).map(e => e.trim())
  ];
  return { env, varNames };
};
