import {
  isArrayType,
  cypherDirectiveArgs,
  safeLabel,
  safeVar,
  getFilterParams,
  lowFirstLetter,
  isAddMutation,
  isCreateMutation,
  isUpdateMutation,
  isRemoveMutation,
  isMergeMutation,
  isDeleteMutation,
  computeOrderBy,
  innerFilterParams,
  paramsToString,
  filterNullParams,
  getOuterSkipLimit,
  getQueryCypherDirective,
  getMutationArguments,
  setPrimaryKeyValue,
  buildCypherParameters,
  getQueryArguments,
  initializeMutationParams,
  getMutationCypherDirective,
  isNodeType,
  getRelationTypeDirective,
  isRelationTypePayload,
  splitSelectionParameters,
  getNeo4jTypeArguments,
  neo4jTypePredicateClauses,
  isNeo4jType,
  isTemporalType,
  isSpatialType,
  isSpatialDistanceInputType,
  isGraphqlScalarType,
  isGraphqlInterfaceType,
  isGraphqlUnionType,
  innerType,
  relationDirective,
  typeIdentifiers,
  getAdditionalLabels,
  getInterfaceDerivedTypeNames,
  getPayloadSelections,
  isGraphqlObjectType,
  decideNeo4jTypeConstructor
} from './utils';
import { getPrimaryKey } from './augment/types/node/selection';
import {
  getNamedType,
  isScalarType,
  isEnumType,
  isObjectType,
  isInterfaceType
} from 'graphql';
import {
  buildCypherSelection,
  isFragmentedSelection,
  getDerivedTypes,
  getUnionDerivedTypes,
  mergeSelectionFragments
} from './selections';
import _ from 'lodash';
import neo4j from 'neo4j-driver';
import { isUnionTypeDefinition } from './augment/types/types';
import {
  getFederatedOperationData,
  setCompoundKeyFilter,
  NEO4j_GRAPHQL_SERVICE
} from './federation';
import {
  unwrapNamedType,
  isListTypeField,
  TypeWrappers
} from './augment/fields';
import {
  analyzeMutationArguments,
  isNeo4jTypeArgument,
  OrderingArgument
} from './augment/input-values';
import {
  isRelationshipMutationOutputType,
  isReflexiveRelationshipOutputType
} from './augment/types/relationship/query';
import { getAuthzPredicates, toArgString } from './dynamic-auth';
import { has, identity, toPairs } from 'ramda';

export const customCypherField = ({
  customCypherStatement,
  cypherParams,
  paramIndex,
  schemaTypeRelation,
  isObjectTypeField,
  isInterfaceTypeField,
  isUnionTypeField,
  usesFragments,
  schemaTypeFields,
  derivedTypeMap,
  initial,
  fieldName,
  fieldType,
  nestedVariable,
  variableName,
  headSelection,
  schemaType,
  innerSchemaType,
  resolveInfo,
  subSelection,
  skipLimit,
  commaIfTail,
  tailParams,
  isFederatedOperation,
  context
}) => {
  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName
  });
  const { filter, shield } = authzPredicates;
  const [mapProjection, labelPredicate] = buildMapProjection({
    isComputedField: true,
    schemaType: innerSchemaType,
    isObjectType: isObjectTypeField,
    isInterfaceType: isInterfaceTypeField,
    isUnionType: isUnionTypeField,
    usesFragments,
    safeVariableName: nestedVariable,
    subQuery: subSelection[0],
    schemaTypeFields,
    derivedTypeMap,
    resolveInfo,
    authzPredicates
  });
  const headListWrapperPrefix = `${!isArrayType(fieldType) ? 'head(' : ''}`;
  const headListWrapperSuffix = `${!isArrayType(fieldType) ? ')' : ''}`;
  // For @cypher fields with object payload types, customCypherField is
  // called after the recursive call to compute a subSelection. But recurse()
  // increments paramIndex. So here we need to decrement it in order to map
  // appropriately to the indexed keys produced in getFilterParams()
  const cypherFieldParamsIndex = paramIndex - 1;
  if (schemaTypeRelation) {
    variableName = `${variableName}_relation`;
  }
  return {
    initial: `${initial}${fieldName}: ${shield(
      `${headListWrapperPrefix}${
        labelPredicate ? `[${nestedVariable} IN ` : ''
      }[ ${nestedVariable} IN apoc.cypher.runFirstColumn("${customCypherStatement}", {${cypherDirectiveArgs(
        variableName,
        headSelection,
        cypherParams,
        schemaType,
        resolveInfo,
        cypherFieldParamsIndex,
        isFederatedOperation,
        context
      )}}, true) ${labelPredicate}| ${
        labelPredicate ? `${nestedVariable}] | ` : ''
      }${mapProjection}]${headListWrapperSuffix}${skipLimit} ${commaIfTail}`
    )}`,
    ...tailParams
  };
};

export const relationFieldOnNodeType = ({
  context,
  initial,
  fieldName,
  fieldType,
  fieldSelectionSet,
  variableName,
  relDirection,
  relType,
  nestedVariable,
  schemaType,
  schemaTypeFields,
  derivedTypeMap,
  isObjectTypeField,
  isInterfaceTypeField,
  isUnionTypeField,
  usesFragments,
  innerSchemaType,
  paramIndex,
  fieldArgs,
  filterParams,
  selectionFilters,
  neo4jTypeArgs,
  fieldsForTranslation,
  subSelection,
  skipLimit,
  commaIfTail,
  tailParams,
  resolveInfo,
  cypherParams
}) => {
  const safeVariableName = safeVar(nestedVariable);
  const subQuery = subSelection[0];

  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName: safeVariableName
  });
  const { filter, shield } = authzPredicates;
  const [mapProjection, labelPredicate] = buildMapProjection({
    schemaType: innerSchemaType,
    isObjectType: isObjectTypeField,
    isInterfaceType: isInterfaceTypeField,
    isUnionType: isUnionTypeField,
    usesFragments,
    safeVariableName,
    subQuery,
    schemaTypeFields,
    derivedTypeMap,
    resolveInfo,
    authzPredicates
  });
  const allParams = innerFilterParams(filterParams, neo4jTypeArgs);
  const queryParams = paramsToString(
    _.filter(allParams, param => {
      const value =
        param.value.value !== undefined ? param.value.value : param.value;
      return !Array.isArray(value);
    })
  );

  const [filterPredicates, serializedFilterParam] = processFilterArgument({
    fieldArgs,
    schemaType: innerSchemaType,
    variableName: nestedVariable,
    resolveInfo,
    params: selectionFilters,
    paramIndex
  });
  const filterParamKey = `${tailParams.paramIndex}_filter`;
  const fieldArgumentParams = subSelection[1];
  const filterParam = fieldArgumentParams[filterParamKey];
  if (
    filterParam &&
    typeof serializedFilterParam[filterParamKey] !== 'undefined'
  ) {
    subSelection[1][filterParamKey] = serializedFilterParam[filterParamKey];
  }

  const neo4jTypeClauses = neo4jTypePredicateClauses(
    filterParams,
    nestedVariable,
    neo4jTypeArgs
  );

  const arrayPredicates = translateListArguments({
    schemaType: innerSchemaType,
    fieldArgs,
    filterParams,
    safeVariableName,
    resolveInfo
  });

  const [lhsOrdering, rhsOrdering] = translateNestedOrderingArgument({
    schemaType: innerSchemaType,
    selections: fieldsForTranslation,
    fieldSelectionSet,
    filterParams
  });

  let whereClauses = [
    labelPredicate,
    ...neo4jTypeClauses,
    ...arrayPredicates,
    ...filterPredicates,
    filter
  ].filter(predicate => !!predicate);

  tailParams.initial = `${initial} ${fieldName}: ${shield(
    `${!isArrayType(fieldType) ? 'head(' : ''}${lhsOrdering}[(${safeVar(
      variableName
    )})${
      isUnionTypeField
        ? `--`
        : `${
            relDirection === 'in' || relDirection === 'IN' ? '<' : ''
          }-[:${safeLabel([relType])}]-${
            relDirection === 'out' || relDirection === 'OUT' ? '>' : ''
          }`
    }(${safeVariableName}${`:${safeLabel([
      innerSchemaType.name,
      ...getAdditionalLabels(
        resolveInfo.schema.getType(innerSchemaType.name),
        cypherParams
      )
    ])}`}${queryParams})${
      whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
    } | ${mapProjection}]${rhsOrdering}${
      !isArrayType(fieldType) ? ')' : ''
    }${skipLimit}`
  )} ${commaIfTail}`;

  return [tailParams, subSelection];
};

export const relationTypeFieldOnNodeType = ({
  innerSchemaTypeRelation,
  initial,
  fieldName,
  fieldSelectionSet,
  subSelection,
  skipLimit,
  commaIfTail,
  tailParams,
  fieldType,
  variableName,
  fieldsForTranslation,
  schemaType,
  innerSchemaType,
  nestedVariable,
  filterParams,
  neo4jTypeArgs,
  resolveInfo,
  selectionFilters,
  paramIndex,
  fieldArgs,
  cypherParams,
  context
}) => {
  const { filter, shield } = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName
  });
  let translation = '';
  if (innerSchemaTypeRelation.from === innerSchemaTypeRelation.to) {
    translation = `${initial}${fieldName}: ${shield(
      `{${subSelection[0]}}${skipLimit}`
    )} ${commaIfTail}`;
  } else {
    const relationshipVariableName = `${nestedVariable}_relation`;
    const neo4jTypeClauses = neo4jTypePredicateClauses(
      filterParams,
      relationshipVariableName,
      neo4jTypeArgs
    );
    const [filterPredicates, serializedFilterParam] = processFilterArgument({
      fieldArgs,
      parentSchemaType: schemaType,
      schemaType: innerSchemaType,
      variableName: relationshipVariableName,
      resolveInfo,
      params: selectionFilters,
      paramIndex,
      rootIsRelationType: true
    });
    const filterParamKey = `${tailParams.paramIndex}_filter`;
    const fieldArgumentParams = subSelection[1];
    const filterParam = fieldArgumentParams[filterParamKey];
    if (
      filterParam &&
      typeof serializedFilterParam[filterParamKey] !== 'undefined'
    ) {
      subSelection[1][filterParamKey] = serializedFilterParam[filterParamKey];
    }

    const allParams = innerFilterParams(filterParams, neo4jTypeArgs);
    const queryParams = paramsToString(
      _.filter(allParams, param => {
        const value =
          param.value.value !== undefined ? param.value.value : param.value;
        return !Array.isArray(value);
      })
    );

    const arrayPredicates = translateListArguments({
      schemaType: innerSchemaType,
      fieldArgs,
      filterParams,
      safeVariableName: safeVar(relationshipVariableName),
      resolveInfo
    });

    const [lhsOrdering, rhsOrdering] = translateNestedOrderingArgument({
      schemaType: innerSchemaType,
      selections: fieldsForTranslation,
      fieldSelectionSet,
      filterParams
    });

    const fromTypeName = innerSchemaTypeRelation.from;
    const toTypeName = innerSchemaTypeRelation.to;
    const schemaTypeName = schemaType.name;
    const isFromField = schemaTypeName === fromTypeName;
    const isToField = schemaTypeName === toTypeName;

    const incomingNodeTypeName = innerSchemaTypeRelation.from;
    const outgoingNodeTypeName = innerSchemaTypeRelation.to;
    const innerSchemaTypeFields = innerSchemaType.getFields();
    const selectsIncomingField = innerSchemaTypeFields[incomingNodeTypeName];
    const selectsOutgoingField = innerSchemaTypeFields[outgoingNodeTypeName];
    const nestedTypeLabels =
      selectsOutgoingField || isFromField
        ? [
            toTypeName,
            ...getAdditionalLabels(
              resolveInfo.schema.getType(toTypeName),
              cypherParams
            )
          ]
        : [
            fromTypeName,
            ...getAdditionalLabels(
              resolveInfo.schema.getType(fromTypeName),
              cypherParams
            )
          ];

    const whereClauses = [
      ...neo4jTypeClauses,
      ...filterPredicates,
      ...arrayPredicates,
      filter
    ].filter(Boolean);
    translation = `${initial}${fieldName}: ${shield(
      `${!isArrayType(fieldType) ? 'head(' : ''}${lhsOrdering}[(${safeVar(
        variableName
      )})${
        // if its fromField -- is this logically equivalent?
        selectsIncomingField || isToField ? '<' : ''
      }-[${safeVar(relationshipVariableName)}:${safeLabel(
        innerSchemaTypeRelation.name
      )}${queryParams}]-${
        selectsOutgoingField || isFromField ? '>' : ''
      }(:${safeLabel(nestedTypeLabels)}) ${
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')} ` : ''
      }| ${relationshipVariableName} {${subSelection[0]}}]${rhsOrdering}${
        !isArrayType(fieldType) ? ')' : ''
      }${skipLimit}`
    )} ${commaIfTail}`;
  }

  tailParams.initial = translation;
  return [tailParams, subSelection];
};

export const nodeTypeFieldOnRelationType = ({
  initial,
  schemaType,
  fieldName,
  fieldType,
  variableName,
  nestedVariable,
  subSelection,
  skipLimit,
  commaIfTail,
  tailParams,
  filterParams,
  neo4jTypeArgs,
  schemaTypeRelation,
  innerSchemaType,
  fieldSelectionSet,
  fieldsForTranslation,
  schemaTypeFields,
  derivedTypeMap,
  isObjectTypeField,
  isInterfaceTypeField,
  isUnionTypeField,
  usesFragments,
  paramIndex,
  parentSelectionInfo,
  resolveInfo,
  selectionFilters,
  fieldArgs,
  cypherParams,
  context
}) => {
  if (isRelationshipMutationOutputType({ schemaType })) {
    const fromArgName = parentSelectionInfo.fromArgName;
    const toArgName = parentSelectionInfo.toArgName;
    const nodeFieldVariableName = decideRootRelationshipTypeNodeVariable({
      parentSelectionInfo,
      fieldName,
      fromArgName,
      toArgName
    });
    const authzPredicates = getAuthzPredicates({
      context,
      cypherParams,
      fieldName,
      innerSchemaType,
      resolveInfo,
      schemaType,
      variableName
    });
    const [mapProjection, labelPredicate] = buildMapProjection({
      schemaType: innerSchemaType,
      isObjectType: isObjectTypeField,
      isInterfaceType: isInterfaceTypeField,
      isUnionType: isUnionTypeField,
      safeVariableName: nodeFieldVariableName,
      subQuery: subSelection[0],
      usesFragments,
      schemaTypeFields,
      derivedTypeMap,
      resolveInfo,
      authzPredicates
    });
    const translationParams = relationTypeMutationPayloadField({
      initial,
      fieldName,
      mapProjection,
      skipLimit,
      commaIfTail,
      tailParams,
      context,
      cypherParams,
      innerSchemaType,
      resolveInfo,
      schemaType,
      variableName
    });
    return [translationParams, subSelection];
  }
  // Normal case of schemaType with a relationship directive
  return directedNodeTypeFieldOnRelationType({
    initial,
    schemaType,
    fieldName,
    fieldType,
    variableName,
    nestedVariable,
    subSelection,
    skipLimit,
    commaIfTail,
    tailParams,
    schemaTypeRelation,
    innerSchemaType,
    fieldSelectionSet,
    fieldsForTranslation,
    usesFragments,
    isObjectTypeField,
    isInterfaceTypeField,
    isUnionTypeField,
    filterParams,
    neo4jTypeArgs,
    paramIndex,
    resolveInfo,
    selectionFilters,
    schemaTypeFields,
    derivedTypeMap,
    fieldArgs,
    cypherParams,
    parentSelectionInfo
  });
};

export const neo4jTypeField = ({
  initial,
  fieldName,
  commaIfTail,
  tailParams,
  parentSelectionInfo,
  secondParentSelectionInfo,
  context,
  cypherParams,
  innerSchemaType,
  resolveInfo,
  schemaType
}) => {
  const parentFieldName = parentSelectionInfo.fieldName;
  const parentFieldType = parentSelectionInfo.fieldType;
  const parentSchemaType = parentSelectionInfo.schemaType;
  const parentVariableName = parentSelectionInfo.variableName;
  const secondParentVariableName = secondParentSelectionInfo.variableName;
  // Initially assume that the parent type of the temporal type
  // containing this temporal field was a node
  let variableName = parentVariableName;
  let fieldIsArray = isArrayType(parentFieldType);
  if (parentSchemaType && !isNodeType(parentSchemaType.astNode)) {
    // initial assumption wrong, build appropriate relationship variable
    if (isRelationshipMutationOutputType({ schemaType: parentSchemaType })) {
      // If the second parent selection scope above is the root
      // then we need to use the root variableName
      variableName = `${secondParentVariableName}_relation`;
    } else if (isRelationTypePayload(parentSchemaType)) {
      const parentSchemaTypeRelation = getRelationTypeDirective(
        parentSchemaType.astNode
      );
      if (parentSchemaTypeRelation.from === parentSchemaTypeRelation.to) {
        variableName = `${variableName}_relation`;
      } else {
        variableName = `${variableName}_relation`;
      }
    }
  }
  const { filter, shield } = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName
  });
  return {
    initial: `${initial} ${fieldName}: ${shield(
      fieldIsArray
        ? `${
            fieldName === 'formatted'
              ? `toString(INSTANCE)`
              : `INSTANCE.${fieldName}`
          } ${commaIfTail}`
        : `${
            fieldName === 'formatted'
              ? `toString(${safeVar(
                  variableName
                )}.${parentFieldName}) ${commaIfTail}`
              : `${safeVar(
                  variableName
                )}.${parentFieldName}.${fieldName} ${commaIfTail}`
          }`
    )}`,
    ...tailParams
  };
};

export const neo4jType = ({
  initial,
  fieldName,
  subSelection,
  commaIfTail,
  tailParams,
  variableName,
  nestedVariable,
  fieldType,
  schemaType,
  schemaTypeRelation,
  parentSelectionInfo,
  context,
  cypherParams,
  innerSchemaType,
  resolveInfo
}) => {
  const { shield } = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName
  });
  const parentVariableName = parentSelectionInfo.variableName;
  const parentFilterParams = parentSelectionInfo.filterParams;
  const parentSchemaType = parentSelectionInfo.schemaType;
  const relationshipVariableSuffix = `relation`;
  let fieldIsArray = isArrayType(fieldType);
  const isOrderedForNodeType = temporalOrderingFieldExists(
    parentSchemaType,
    parentFilterParams
  );
  const isOrderedForRelationshipType = temporalOrderingFieldExists(
    schemaType,
    parentFilterParams
  );
  if (!isNodeType(schemaType.astNode)) {
    if (
      isRelationTypePayload(schemaType) &&
      schemaTypeRelation.from === schemaTypeRelation.to
    ) {
      variableName = `${nestedVariable}_${relationshipVariableSuffix}`;
    } else {
      if (fieldIsArray) {
        if (isRelationshipMutationOutputType({ schemaType })) {
          variableName = `${parentVariableName}_${relationshipVariableSuffix}`;
        } else {
          variableName = `${variableName}_${relationshipVariableSuffix}`;
        }
      } else {
        if (isOrderedForRelationshipType) {
          variableName = `${variableName}_${relationshipVariableSuffix}`;
        } else {
          variableName = `${nestedVariable}_${relationshipVariableSuffix}`;
        }
      }
    }
  }
  const safeVariableName = safeVar(variableName);
  const usesTemporalOrdering =
    isOrderedForNodeType || isOrderedForRelationshipType;
  return {
    initial: `${initial}${fieldName}: ${shield(
      `${
        fieldIsArray
          ? `reduce(a = [], INSTANCE IN ${variableName}.${fieldName} | a + {${subSelection[0]}})${commaIfTail}`
          : usesTemporalOrdering
          ? `${safeVariableName}.${fieldName}${commaIfTail}`
          : `{${subSelection[0]}}${commaIfTail}`
      }`
    )}`,
    ...tailParams
  };
};

export const translateQuery = ({
  resolveInfo,
  context,
  first,
  offset,
  _id,
  orderBy,
  otherParams
}) => {
  const { typeName, variableName } = typeIdentifiers(resolveInfo.returnType);
  const schemaType = resolveInfo.schema.getType(typeName);
  const typeMap = resolveInfo.schema.getTypeMap();
  const selections = getPayloadSelections(resolveInfo);
  const isInterfaceType = isGraphqlInterfaceType(schemaType);
  const isUnionType = isGraphqlUnionType(schemaType);
  const isObjectType = isGraphqlObjectType(schemaType);
  let [nullParams, nonNullParams] = filterNullParams({
    offset,
    first,
    otherParams
  });

  // Check is this is a federated operation, in which case get the lookup keys
  const operation = resolveInfo.operation || {};
  // check if the operation name is the name used for generated queries
  const isFederatedOperation =
    operation.name && operation.name.value === NEO4j_GRAPHQL_SERVICE;
  const queryTypeCypherDirective = getQueryCypherDirective(
    resolveInfo,
    isFederatedOperation
  );
  let scalarKeys = {};
  let compoundKeys = {};
  let requiredData = {};
  if (isFederatedOperation) {
    const operationData = getFederatedOperationData({ context });
    scalarKeys = operationData.scalarKeys;
    compoundKeys = operationData.compoundKeys;
    requiredData = operationData.requiredData;
    if (queryTypeCypherDirective) {
      // all nonnull keys become available as cypher variables
      nonNullParams = {
        ...scalarKeys,
        ...compoundKeys,
        ...requiredData
      };
    } else {
      // all scalar keys get used as field arguments, while relationship
      // field keys being translated as a filter argument
      nonNullParams = {
        ...scalarKeys
      };
    }
  }

  let filterParams = getFilterParams(nonNullParams);
  const queryArgs = getQueryArguments(resolveInfo, isFederatedOperation);
  const neo4jTypeArgs = getNeo4jTypeArguments(queryArgs);
  const cypherParams = getCypherParams(context);
  const queryParams = paramsToString(
    innerFilterParams(
      filterParams,
      neo4jTypeArgs,
      null,
      queryTypeCypherDirective ? true : false
    ),
    cypherParams
  );
  const safeVariableName = safeVar(variableName);
  const neo4jTypeClauses = neo4jTypePredicateClauses(
    filterParams,
    safeVariableName,
    neo4jTypeArgs
  );
  const outerSkipLimit = getOuterSkipLimit(first, offset);
  const orderByValue = computeOrderBy(resolveInfo, schemaType);

  let usesFragments = isFragmentedSelection({ selections });
  const isFragmentedInterfaceType = usesFragments && isInterfaceType;
  const isFragmentedObjectType = usesFragments && isObjectType;
  const [schemaTypeFields, derivedTypeMap] = mergeSelectionFragments({
    schemaType,
    selections,
    isFragmentedObjectType,
    isFragmentedInterfaceType,
    isUnionType,
    typeMap,
    resolveInfo
  });

  const hasOnlySchemaTypeFragments =
    schemaTypeFields.length > 0 && Object.keys(derivedTypeMap).length === 0;
  if (hasOnlySchemaTypeFragments) {
    usesFragments = false;
  }

  let translation = ``;
  let translationParams = {};
  if (queryTypeCypherDirective) {
    [translation, translationParams] = customQuery({
      resolveInfo,
      context,
      cypherParams,
      schemaType,
      argString: queryParams,
      selections,
      variableName,
      safeVariableName,
      isObjectType,
      isInterfaceType,
      isUnionType,
      isFragmentedInterfaceType,
      usesFragments,
      schemaTypeFields,
      derivedTypeMap,
      orderByValue,
      outerSkipLimit,
      queryTypeCypherDirective,
      nonNullParams
    });
  } else {
    const additionalLabels = getAdditionalLabels(schemaType, cypherParams);
    if (isFederatedOperation) {
      nonNullParams = setCompoundKeyFilter({
        params: nonNullParams,
        compoundKeys
      });
      nonNullParams = {
        ...nonNullParams,
        ...otherParams,
        ...requiredData
      };
    }
    [translation, translationParams] = nodeQuery({
      resolveInfo,
      isFederatedOperation,
      context,
      cypherParams,
      schemaType,
      argString: queryParams,
      selections,
      variableName,
      typeName,
      isObjectType,
      isInterfaceType,
      isUnionType,
      isFragmentedInterfaceType,
      isFragmentedObjectType,
      usesFragments,
      schemaTypeFields,
      derivedTypeMap,
      additionalLabels,
      neo4jTypeClauses,
      orderByValue,
      outerSkipLimit,
      nullParams,
      nonNullParams,
      filterParams,
      neo4jTypeArgs,
      _id,
      fieldName: resolveInfo.fieldName,
      typeNames: [typeName]
    });
  }
  return [translation, translationParams];
};

export const translateMutation = ({
  resolveInfo,
  context,
  first,
  offset,
  otherParams
}) => {
  const typeMap = resolveInfo.schema.getTypeMap();
  const { typeName, variableName } = typeIdentifiers(resolveInfo.returnType);
  const schemaType = resolveInfo.schema.getType(typeName);
  const selections = getPayloadSelections(resolveInfo);
  const outerSkipLimit = getOuterSkipLimit(first, offset);
  const orderByValue = computeOrderBy(resolveInfo, schemaType);
  const additionalNodeLabels = getAdditionalLabels(
    schemaType,
    getCypherParams(context)
  );
  const mutationTypeCypherDirective = getMutationCypherDirective(resolveInfo);
  const mutationMeta = resolveInfo.schema
    .getMutationType()
    .getFields()
    [resolveInfo.fieldName].astNode.directives.find(x => {
      return x.name.value === 'MutationMeta';
    });

  const fieldArguments = getMutationArguments(resolveInfo);
  const serializedParams = analyzeMutationArguments({
    fieldArguments,
    values: otherParams,
    resolveInfo
  });
  const params = initializeMutationParams({
    mutationMeta,
    resolveInfo,
    mutationTypeCypherDirective,
    first,
    otherParams: serializedParams,
    offset
  });

  const isInterfaceType = isGraphqlInterfaceType(schemaType);
  const isObjectType = isGraphqlObjectType(schemaType);
  const isUnionType = isGraphqlUnionType(schemaType);

  const usesFragments = isFragmentedSelection({ selections });
  const isFragmentedObjectType = usesFragments && isObjectType;
  const isFragmentedInterfaceType = usesFragments && isInterfaceType;

  const interfaceLabels =
    typeof schemaType.getInterfaces === 'function'
      ? schemaType.getInterfaces().map(i => i.name)
      : [];

  const unionLabels = getUnionLabels({ typeName, typeMap });
  const additionalLabels = [
    ...additionalNodeLabels,
    ...interfaceLabels,
    ...unionLabels
  ];

  const [schemaTypeFields, derivedTypeMap] = mergeSelectionFragments({
    schemaType,
    selections,
    isFragmentedObjectType,
    isFragmentedInterfaceType,
    isUnionType,
    typeMap,
    resolveInfo
  });

  let translation = ``;
  let translationParams = {};
  if (mutationTypeCypherDirective) {
    [translation, translationParams] = customMutation({
      resolveInfo,
      schemaType,
      schemaTypeFields,
      derivedTypeMap,
      isObjectType,
      isInterfaceType,
      isUnionType,
      usesFragments,
      selections,
      params,
      context,
      mutationTypeCypherDirective,
      variableName,
      orderByValue,
      outerSkipLimit
    });
  } else if (isCreateMutation(resolveInfo)) {
    [translation, translationParams] = nodeCreate({
      resolveInfo,
      schemaType,
      selections,
      params,
      context,
      variableName,
      typeName,
      additionalLabels,
      typeMap
    });
  } else if (isDeleteMutation(resolveInfo)) {
    [translation, translationParams] = nodeDelete({
      resolveInfo,
      schemaType,
      selections,
      params,
      variableName,
      typeName
    });
  } else if (isAddMutation(resolveInfo)) {
    [translation, translationParams] = relationshipCreate({
      resolveInfo,
      schemaType,
      selections,
      params,
      context
    });
  } else if (isUpdateMutation(resolveInfo) || isMergeMutation(resolveInfo)) {
    /**
     * TODO: Once we are no longer using the @MutationMeta directive
     * on relationship mutations, we will need to more directly identify
     * whether this Merge mutation if for a node or relationship
     */
    if (mutationMeta) {
      [translation, translationParams] = relationshipMergeOrUpdate({
        mutationMeta,
        resolveInfo,
        selections,
        schemaType,
        params,
        context
      });
    } else {
      [translation, translationParams] = nodeMergeOrUpdate({
        resolveInfo,
        variableName,
        typeName,
        selections,
        schemaType,
        additionalLabels,
        params,
        context,
        typeMap
      });
    }
  } else if (isRemoveMutation(resolveInfo)) {
    [translation, translationParams] = relationshipDelete({
      resolveInfo,
      schemaType,
      selections,
      params,
      context
    });
  } else {
    // throw error - don't know how to handle this type of mutation
    throw new Error(
      'Do not know how to handle this type of mutation. Mutation does not follow naming convention.'
    );
  }
  return [translation, translationParams];
};

export const derivedTypesParams = ({
  isInterfaceType,
  isUnionType,
  schema,
  schemaTypeName,
  usesFragments
}) => {
  const params = {};
  if (!usesFragments) {
    if (isInterfaceType) {
      const paramName = derivedTypesParamName(schemaTypeName);
      params[paramName] = getInterfaceDerivedTypeNames(schema, schemaTypeName);
    } else if (isUnionType) {
      const paramName = derivedTypesParamName(schemaTypeName);
      const typeMap = schema.getTypeMap();
      const schemaType = typeMap[schemaTypeName];
      const types = schemaType.getTypes();
      params[paramName] = types.map(type => type.name);
    }
  }
  return params;
};

export const fragmentType = (varName, schemaTypeName) =>
  `FRAGMENT_TYPE: head( [ label IN labels(${varName}) WHERE label IN $${derivedTypesParamName(
    schemaTypeName
  )} ] )`;

export const translateListArguments = ({
  schemaType,
  fieldArgs,
  filterParams,
  safeVariableName,
  resolveInfo
}) => {
  const arrayPredicates = [];
  fieldArgs.forEach(fieldArgument => {
    const argumentName = fieldArgument.name.value;
    const param = filterParams[argumentName];
    const isGeneratedListArgument = argumentName === OrderingArgument.ORDER_BY;
    const usesArgument = param !== undefined;
    if (
      usesArgument &&
      isListTypeField({ field: fieldArgument }) &&
      !isGeneratedListArgument
    ) {
      const filterValue = param.value !== undefined ? param.value : param;
      const indexedParam = filterParams[argumentName];
      const paramIndex = indexedParam.index;
      const field = schemaType.getFields()[argumentName];
      const listVariable = `${safeVariableName}.${safeVar(argumentName)}`;
      let paramPath = `$${argumentName}`;
      // Possibly use the already generated index used when naming nested parameters
      if (paramIndex >= 1) paramPath = `$${paramIndex}_${argumentName}`;
      let translation = '';
      if (field) {
        // list argument matches the name of a field
        const type = fieldArgument.type;
        const unwrappedType = unwrapNamedType({ type });
        const typeName = unwrappedType.name;
        const fieldType = resolveInfo.schema.getType(typeName);
        const isNeo4jType = isNeo4jTypeArgument({ fieldArgument });
        if (isScalarType(fieldType) || isEnumType(fieldType) || isNeo4jType) {
          let whereClause = '';
          if (
            isListTypeField({ field: field.astNode }) &&
            Array.isArray(filterValue)
          ) {
            // The matching field is also a list
            translation = translateListArgument({
              typeName,
              filterValue,
              isNeo4jType,
              listVariable,
              paramPath
            });
          } else {
            // the matching field is not also a list
            if (isNeo4jType) {
              whereClause = translateCustomTypeListArgument({
                typeName,
                propertyVariable: listVariable,
                filterValue
              });
              translation = cypherList({
                listVariable: paramPath,
                whereClause
              });
            } else
              translation = cypherList({
                variable: listVariable,
                listVariable: paramPath
              });
          }
        }
      } else {
        // list argument does not match a field on the queried type
        translation = cypherList({
          variable: listVariable,
          listVariable: paramPath
        });
      }
      arrayPredicates.push(translation);
    }
  });
  return arrayPredicates;
};

export const derivedTypesParamName = schemaTypeName =>
  `${schemaTypeName}_derivedTypes`;

export const decideRootRelationshipTypeNodeVariable = ({
  parentSelectionInfo = {},
  fieldName = '',
  fromArgName = '',
  toArgName = ''
}) => {
  const fromVariable =
    parentSelectionInfo.from || parentSelectionInfo[fromArgName];
  const toVariable = parentSelectionInfo.to || parentSelectionInfo[toArgName];
  // assume incoming
  let variableName = safeVar(fromVariable);
  // else set as outgoing
  if (fieldName === 'to' || fieldName === toArgName)
    variableName = safeVar(toVariable);
  return variableName;
};

export const relationTypeMutationPayloadField = ({
  initial,
  fieldName,
  mapProjection,
  skipLimit,
  commaIfTail,
  tailParams,
  context,
  cypherParams,
  innerSchemaType,
  resolveInfo,
  schemaType,
  variableName
}) => {
  const { shield } = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName
  });
  const translation = `${initial}${fieldName}: ${shield(
    `${mapProjection}${skipLimit}`
  )} ${commaIfTail}`;
  return {
    initial: translation,
    ...tailParams
  };
};

export const directedNodeTypeFieldOnRelationType = ({
  initial,
  schemaType,
  fieldName,
  fieldType,
  variableName,
  nestedVariable,
  subSelection,
  skipLimit,
  commaIfTail,
  tailParams,
  schemaTypeRelation,
  innerSchemaType,
  fieldSelectionSet,
  fieldsForTranslation,
  usesFragments,
  isObjectTypeField,
  isInterfaceTypeField,
  isUnionTypeField,
  filterParams,
  neo4jTypeArgs,
  paramIndex,
  resolveInfo,
  selectionFilters,
  schemaTypeFields,
  derivedTypeMap,
  fieldArgs,
  cypherParams,
  parentSelectionInfo,
  context
}) => {
  const relType = schemaTypeRelation.name;
  const fromTypeName = schemaTypeRelation.from;
  const toTypeName = schemaTypeRelation.to;
  const parentSchemaTypeName = parentSelectionInfo.schemaType.name;
  const innerSchemaTypeName = innerSchemaType.name;
  let isFromField =
    innerSchemaTypeName === fromTypeName || fieldName === 'from';
  let isToField = innerSchemaTypeName === toTypeName || fieldName === 'to';
  const safeVariableName = nestedVariable;
  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName,
    innerSchemaType,
    resolveInfo,
    schemaType,
    variableName: safeVariableName
  });
  const { filter, shield } = authzPredicates;
  const [mapProjection, labelPredicate] = buildMapProjection({
    schemaType: innerSchemaType,
    isObjectType: isObjectTypeField,
    isInterfaceType: isInterfaceTypeField,
    isUnionType: isUnionTypeField,
    usesFragments,
    safeVariableName,
    subQuery: subSelection[0],
    schemaTypeFields,
    derivedTypeMap,
    resolveInfo,
    authzPredicates
  });
  const allParams = innerFilterParams(filterParams, neo4jTypeArgs);
  const queryParams = paramsToString(
    _.filter(allParams, param => {
      const value =
        param.value.value !== undefined ? param.value.value : param.value;
      return !Array.isArray(value);
    })
  );
  // Since the translations are significantly different,
  // we first check whether the relationship is reflexive
  if (fromTypeName === toTypeName) {
    const relationshipVariableName = `${variableName}_${
      isFromField ? 'from' : 'to'
    }_relation`;
    if (isReflexiveRelationshipOutputType({ schemaType })) {
      isFromField = schemaType.astNode.fields[0].name.value === fieldName;
      isToField = schemaType.astNode.fields[1].name.value === fieldName;
      const temporalFieldRelationshipVariableName = `${nestedVariable}_relation`;
      const neo4jTypeClauses = neo4jTypePredicateClauses(
        filterParams,
        temporalFieldRelationshipVariableName,
        neo4jTypeArgs
      );
      const [filterPredicates, serializedFilterParam] = processFilterArgument({
        fieldArgs,
        schemaType: innerSchemaType,
        variableName: relationshipVariableName,
        resolveInfo,
        params: selectionFilters,
        paramIndex,
        rootIsRelationType: true
      });
      const filterParamKey = `${tailParams.paramIndex}_filter`;
      const fieldArgumentParams = subSelection[1];
      const filterParam = fieldArgumentParams[filterParamKey];

      if (
        filterParam &&
        typeof serializedFilterParam[filterParamKey] !== 'undefined'
      ) {
        subSelection[1][filterParamKey] = serializedFilterParam[filterParamKey];
      }

      const arrayPredicates = translateListArguments({
        schemaType: innerSchemaType,
        fieldArgs,
        filterParams,
        safeVariableName: safeVar(relationshipVariableName),
        resolveInfo
      });

      const [lhsOrdering, rhsOrdering] = translateNestedOrderingArgument({
        schemaType: innerSchemaType,
        selections: fieldsForTranslation,
        fieldSelectionSet,
        filterParams
      });

      const whereClauses = [
        ...neo4jTypeClauses,
        ...filterPredicates,
        ...arrayPredicates,
        filter
      ].filter(Boolean);

      tailParams.initial = `${initial}${fieldName}: ${shield(`
        ${!isArrayType(fieldType) ? 'head(' : ''}${lhsOrdering}[(${safeVar(
        variableName
      )})${isFromField ? '<' : ''}-[${safeVar(
        relationshipVariableName
      )}:${safeLabel(relType)}${queryParams}]-${isToField ? '>' : ''}(${safeVar(
        nestedVariable
      )}:${safeLabel([
        parentSchemaTypeName,
        ...getAdditionalLabels(
          resolveInfo.schema.getType(parentSchemaTypeName),
          cypherParams
        )
      ])}) ${
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')} ` : ''
      }| ${relationshipVariableName} {${subSelection[0]}}]${rhsOrdering}${
        !isArrayType(fieldType) ? ')' : ''
      }${skipLimit}`)} ${commaIfTail}`;
      return [tailParams, subSelection];
    } else {
      // Case of a renamed directed field
      // e.g., 'from: Movie' -> 'Movie: Movie'
      tailParams.initial = `${initial}${fieldName}: ${shield(
        `${mapProjection}${skipLimit}`
      )} ${commaIfTail}`;
      return [tailParams, subSelection];
    }
  } else {
    let whereClauses = [labelPredicate, filter].filter(
      predicate => !!predicate
    );
    const safeRelationshipVar = safeVar(`${variableName}_relation`);
    tailParams.initial = `${initial}${fieldName}: ${shield(`
      ${!isArrayType(fieldType) ? 'head(' : ''}[(:${safeLabel(
      isFromField
        ? [
            toTypeName,
            ...getAdditionalLabels(
              resolveInfo.schema.getType(toTypeName),
              cypherParams
            )
          ]
        : [
            fromTypeName,
            ...getAdditionalLabels(
              resolveInfo.schema.getType(fromTypeName),
              cypherParams
            )
          ]
    )})${
      isUnionTypeField
        ? `--`
        : `${isFromField ? '<' : ''}-[${safeRelationshipVar}]-${
            isToField ? '>' : ''
          }`
    }(${safeVar(nestedVariable)}:${safeLabel([
      innerSchemaType.name,
      ...getAdditionalLabels(
        resolveInfo.schema.getType(innerSchemaType.name),
        cypherParams
      )
    ])}${queryParams})${
      whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
    } | ${mapProjection}]${
      !isArrayType(fieldType) ? ')' : ''
    }${skipLimit}`)} ${commaIfTail}`;
    return [tailParams, subSelection];
  }
};

const buildTypeCompositionPredicate = ({
  schemaType,
  schemaTypeFields,
  listVariable = 'x',
  derivedTypeMap,
  safeVariableName,
  isInterfaceType,
  isUnionType,
  isComputedQuery,
  isComputedMutation,
  isComputedField,
  usesFragments,
  resolveInfo,
  authzPredicates
}) => {
  const { filter } = authzPredicates;
  const schemaTypeName = schemaType.name;
  const isFragmentedInterfaceType = usesFragments && isInterfaceType;
  let labelPredicate = '';
  if (isFragmentedInterfaceType || isUnionType) {
    let derivedTypes = [];
    // If shared fields are selected then the translation builds
    // a type specific list comprehension for each interface implementing
    // type. Because of this, the type selecting predicate applied to
    // the interface type path pattern should allow for all possible
    // implementing types
    if (schemaTypeFields.length) {
      derivedTypes = getDerivedTypes({
        schemaTypeName,
        derivedTypeMap,
        isUnionType,
        isFragmentedInterfaceType,
        resolveInfo
      });
    } else if (isUnionType) {
      derivedTypes = getUnionDerivedTypes({
        derivedTypeMap,
        resolveInfo
      });
    } else {
      // Otherwise, use only those types provided in fragments
      derivedTypes = Object.keys(derivedTypeMap);
    }
    const typeSelectionPredicates = derivedTypes.map(selectedType => {
      return `"${selectedType}" IN labels(${safeVariableName})`;
    });
    if (typeSelectionPredicates.length) {
      labelPredicate = `(${typeSelectionPredicates.join(' OR ')})`;
    }
  }
  if (labelPredicate) {
    if (isComputedQuery) {
      labelPredicate = `WITH [${safeVariableName} IN ${listVariable} WHERE (${filter}) AND (${labelPredicate}) | ${safeVariableName}] AS ${listVariable} `;
    } else if (isComputedMutation) {
      labelPredicate = `UNWIND [${safeVariableName} IN ${listVariable} WHERE (${filter}) AND (${labelPredicate}) | ${safeVariableName}] `;
    } else if (isComputedField) {
      labelPredicate = `WHERE (${filter}) AND (${labelPredicate}) `;
    }
  }
  return labelPredicate;
};

export const getCypherParams = context => {
  return context &&
    context.cypherParams &&
    context.cypherParams instanceof Object &&
    Object.keys(context.cypherParams).length > 0
    ? context.cypherParams
    : undefined;
};

// Custom read operation
export const customQuery = ({
  resolveInfo,
  context,
  cypherParams,
  schemaType,
  argString,
  selections,
  variableName,
  isObjectType,
  isInterfaceType,
  isUnionType,
  usesFragments,
  schemaTypeFields,
  derivedTypeMap,
  orderByValue,
  outerSkipLimit,
  queryTypeCypherDirective,
  nonNullParams,
  fieldName,
  typeNames
}) => {
  const safeVariableName = safeVar(variableName);
  const [subQuery, subParams] = buildCypherSelection({
    context,
    cypherParams,
    selections,
    variableName,
    schemaType,
    resolveInfo
  });
  const params = { ...nonNullParams, ...subParams };
  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }
  // QueryType with a @cypher directive
  const cypherQueryArg = queryTypeCypherDirective.arguments.find(x => {
    return x.name.value === 'statement';
  });
  const isScalarType = isGraphqlScalarType(schemaType);
  const isNeo4jTypeOutput = isNeo4jType(schemaType.name);
  const { cypherPart: orderByClause } = orderByValue;
  // Don't add subQuery for scalar type payloads
  const isScalarPayload = isNeo4jTypeOutput || isScalarType;
  const fragmentTypeParams = derivedTypesParams({
    isInterfaceType,
    isUnionType,
    schema: resolveInfo.schema,
    schemaTypeName: schemaType.name,
    usesFragments
  });

  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName: resolveInfo.fieldName,
    resolveInfo,
    schemaType: resolveInfo.parentType.name,
    typeNames: [typeIdentifiers(resolveInfo.returnType).typeName],
    variableName: safeVariableName
  });
  const { apocShield, filter } = authzPredicates;
  let [mapProjection, labelPredicate] = buildMapProjection({
    isComputedQuery: true,
    schemaType,
    schemaTypeFields,
    derivedTypeMap,
    isObjectType,
    isInterfaceType,
    isUnionType,
    isScalarPayload,
    usesFragments,
    safeVariableName,
    subQuery,
    resolveInfo,
    authzPredicates
  });

  const matchMe = cypherParams?.me?.uuid
    ? `MATCH (me: User { uuid: $cypherParams.me.uuid })`
    : 'WITH NULL AS me';
  const unwindClause =
    cypherParams?.me?.uuid && filter
      ? `UNWIND [y in x WHERE ${filter} | y]`
      : 'UNWIND x';

  const query = `${matchMe} ${apocShield(
    `WITH me, apoc.cypher.runFirstColumn("WITH $me AS me ${
      cypherQueryArg.value.value
    }", ${toArgString(
      argString,
      apocShield !== identity
    )}, True) AS x ${labelPredicate}${unwindClause} AS ${safeVariableName} RETURN ${
      isScalarPayload
        ? `${mapProjection} `
        : `${mapProjection} AS ${safeVariableName}${orderByClause}`
    }${outerSkipLimit}`,
    argString
  )}`;

  return [query, { ...params, ...fragmentTypeParams }];
};

// Generated API
export const nodeQuery = ({
  resolveInfo,
  isFederatedOperation,
  context,
  cypherParams,
  schemaType,
  selections,
  variableName,
  typeName,
  isObjectType,
  isInterfaceType,
  isUnionType,
  usesFragments,
  schemaTypeFields,
  derivedTypeMap,
  additionalLabels = [],
  neo4jTypeClauses,
  orderByValue,
  outerSkipLimit,
  nullParams,
  nonNullParams,
  filterParams,
  neo4jTypeArgs,
  _id
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel([typeName, ...additionalLabels]);
  const rootParamIndex = 1;
  const [subQuery, subParams] = buildCypherSelection({
    cypherParams,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: rootParamIndex,
    isFederatedOperation,
    context
  });
  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName: resolveInfo.fieldName,
    resolveInfo,
    schemaType: resolveInfo.parentType.name,
    typeNames: [typeIdentifiers(resolveInfo.returnType).typeName],
    variableName: safeVariableName
  });
  const { filter, shield } = authzPredicates;
  const [mapProjection, labelPredicate] = buildMapProjection({
    schemaType,
    schemaTypeFields,
    derivedTypeMap,
    isObjectType,
    isInterfaceType,
    isUnionType,
    usesFragments,
    safeVariableName,
    subQuery,
    resolveInfo,
    authzPredicates
  });

  const fieldArgs = getQueryArguments(resolveInfo, isFederatedOperation);
  const [filterPredicates, serializedFilter] = processFilterArgument({
    fieldArgs,
    isFederatedOperation,
    schemaType,
    variableName,
    resolveInfo,
    params: nonNullParams,
    paramIndex: rootParamIndex
  });

  let params = { ...serializedFilter, ...subParams };

  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }

  const args = innerFilterParams(filterParams, neo4jTypeArgs);
  const argString = paramsToString(
    _.filter(args, arg => !Array.isArray(arg.value))
  );

  const idWherePredicate =
    typeof _id !== 'undefined' ? `ID(${safeVariableName})=${_id}` : '';
  const nullFieldPredicates = Object.keys(nullParams).map(
    key => `${variableName}.${key} IS NULL`
  );

  const arrayPredicates = translateListArguments({
    schemaType,
    fieldArgs,
    filterParams,
    safeVariableName,
    resolveInfo
  });

  const fragmentTypeParams = derivedTypesParams({
    isInterfaceType,
    isUnionType,
    schema: resolveInfo.schema,
    schemaTypeName: schemaType.name,
    usesFragments
  });

  const predicateClauses = [
    idWherePredicate,
    labelPredicate,
    ...filterPredicates,
    ...nullFieldPredicates,
    ...neo4jTypeClauses,
    ...arrayPredicates,
    filter
  ]
    .filter(predicate => !!predicate)
    .join(' AND ');

  const matchMe = cypherParams?.me?.uuid
    ? `MATCH (me: User { uuid: $cypherParams.me.uuid }) `
    : '';
  const predicate = predicateClauses ? `WHERE ${predicateClauses} ` : '';
  const { optimization, cypherPart: orderByClause } = orderByValue;

  let query = `${matchMe}MATCH (${safeVariableName}:${safeLabelName}${
    argString ? ` ${argString}` : ''
  }) ${predicate}${
    optimization.earlyOrderBy ? `WITH ${safeVariableName}${orderByClause}` : ''
  } RETURN ${mapProjection} AS ${safeVariableName}${
    optimization.earlyOrderBy ? '' : orderByClause
  }${outerSkipLimit}`;

  return [query, { ...params, ...fragmentTypeParams }];
};

export const buildMapProjection = ({
  schemaType,
  schemaTypeFields,
  listVariable,
  derivedTypeMap,
  isObjectType,
  isInterfaceType,
  isUnionType,
  isScalarPayload,
  isComputedQuery,
  isComputedMutation,
  isComputedField,
  usesFragments,
  safeVariableName,
  subQuery,
  resolveInfo,
  authzPredicates
}) => {
  const labelPredicate = buildTypeCompositionPredicate({
    schemaType,
    schemaTypeFields,
    listVariable,
    derivedTypeMap,
    safeVariableName,
    isInterfaceType,
    isUnionType,
    isComputedQuery,
    isComputedMutation,
    isComputedField,
    usesFragments,
    resolveInfo,
    authzPredicates
  });
  const isFragmentedInterfaceType = usesFragments && isInterfaceType;
  const isFragmentedUnionType = usesFragments && isUnionType;
  let mapProjection = '';
  if (isScalarPayload) {
    // A scalar type payload has no map projection
    mapProjection = safeVariableName;
  } else if (isObjectType) {
    mapProjection = `${safeVariableName} {${subQuery}}`;
  } else if (isFragmentedInterfaceType || isFragmentedUnionType) {
    // An interface type possibly uses fragments and a
    // union type necessarily uses fragments
    mapProjection = subQuery;
  } else if (isInterfaceType || isUnionType) {
    // If no fragments are used, then this is an interface type
    // with only interface fields selected
    mapProjection = `${safeVariableName} {${fragmentType(
      safeVariableName,
      schemaType.name
    )}${subQuery ? `,${subQuery}` : ''}}`;
  }
  return [mapProjection, labelPredicate];
};

export const getUnionLabels = ({ typeName = '', typeMap = {} }) => {
  const unionLabels = [];
  Object.keys(typeMap).map(key => {
    const definition = typeMap[key];
    const astNode = definition.astNode;
    if (isUnionTypeDefinition({ definition: astNode })) {
      const types = definition.getTypes();
      const unionTypeName = definition.name;
      if (types.find(type => type.name === typeName)) {
        unionLabels.push(unionTypeName);
      }
    }
  });
  return unionLabels;
};

// Custom write operation
export const customMutation = ({
  params,
  context,
  mutationTypeCypherDirective,
  selections,
  variableName,
  schemaType,
  schemaTypeFields,
  derivedTypeMap,
  isObjectType,
  isInterfaceType,
  isUnionType,
  usesFragments,
  resolveInfo,
  orderByValue,
  outerSkipLimit
}) => {
  const cypherParams = getCypherParams(context);
  const safeVariableName = safeVar(variableName);
  // FIXME: support IN for multiple values -> WHERE
  const argString = paramsToString(
    innerFilterParams(
      getFilterParams(params.params || params),
      null,
      null,
      true
    ),
    cypherParams
  );
  const cypherQueryArg = mutationTypeCypherDirective.arguments.find(x => {
    return x.name.value === 'statement';
  });
  const [subQuery, subParams] = buildCypherSelection({
    selections,
    variableName,
    schemaType,
    resolveInfo,
    cypherParams,
    context
  });
  const isScalarType = isGraphqlScalarType(schemaType);
  const isNeo4jTypeOutput = isNeo4jType(schemaType.name);
  const isScalarField = isNeo4jTypeOutput || isScalarType;
  const { cypherPart: orderByClause } = orderByValue;
  const listVariable = `apoc.map.values(value, [keys(value)[0]])[0] `;
  const authzPredicates = getAuthzPredicates({
    context,
    cypherParams,
    fieldName: resolveInfo.fieldName,
    resolveInfo,
    schemaType: resolveInfo.parentType.name,
    typeNames: [typeIdentifiers(resolveInfo.returnType).typeName],
    variableName: safeVariableName
  });
  const { apocDoShield, filter } = authzPredicates;
  const [mapProjection, labelPredicate] = buildMapProjection({
    isComputedMutation: true,
    listVariable,
    schemaType,
    schemaTypeFields,
    derivedTypeMap,
    isObjectType,
    isInterfaceType,
    isUnionType,
    usesFragments,
    safeVariableName,
    subQuery,
    resolveInfo,
    authzPredicates
  });

  const matchMe = cypherParams?.me?.uuid
    ? `MATCH (me: User { uuid: $cypherParams.me.uuid })`
    : 'WITH NULL AS me';
  // TODO(tlowerison): Implement node filter for custom mutations (might be connected to `listVariable`)
  // const unwindClause = cypherParams?.me?.uuid && filter ? `UNWIND [y in x WHERE ${filter} | y]` : 'UNWIND x';

  let query = '';
  if (labelPredicate) {
    query = `${matchMe} ${apocDoShield(
      `WITH me CALL apoc.cypher.doIt("${
        cypherQueryArg.value.value
      }", ${toArgString(argString, apocDoShield !== identity)}) YIELD value
      ${!isScalarField ? labelPredicate : ''}AS ${safeVariableName}
      RETURN ${
        !isScalarField
          ? `${mapProjection} AS ${safeVariableName}${orderByClause}${outerSkipLimit}`
          : ''
      }`,
      argString
    )}`;
  } else {
    query = `${matchMe} ${apocDoShield(
      `WITH me CALL apoc.cypher.doIt("${
        cypherQueryArg.value.value
      }", ${toArgString(argString, apocDoShield !== identity)}) YIELD value
      WITH me, ${listVariable}AS ${safeVariableName}
      RETURN ${safeVariableName} ${
        !isScalarField
          ? `{${
              isInterfaceType
                ? `${fragmentType(safeVariableName, schemaType.name)},`
                : ''
            }${subQuery}} AS ${safeVariableName}${orderByClause}${outerSkipLimit}`
          : ''
      }`,
      argString
    )}`;
  }
  const fragmentTypeParams = derivedTypesParams({
    isInterfaceType,
    isUnionType,
    schema: resolveInfo.schema,
    schemaTypeName: schemaType.name,
    usesFragments
  });
  params = { ...params, ...subParams, ...fragmentTypeParams };
  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }
  return [query, { ...params }];
};

// Generated API
// Node Create - Update - Delete
export const nodeCreate = ({
  resolveInfo,
  schemaType,
  selections,
  params,
  context,
  variableName,
  typeName,
  additionalLabels,
  typeMap
}) => {
  const safeLabelName = safeLabel([typeName, ...additionalLabels]);
  let statements = [];
  let args = getMutationArguments(resolveInfo);
  const fieldMap = schemaType.getFields();
  const fields = Object.values(fieldMap).map(field => field.astNode);
  const primaryKey = getPrimaryKey({ fields });
  let createStatement = ``;
  const dataArgument = args.find(arg => arg.name.value === 'data');
  let paramKey = 'params';
  let dataParams = params[paramKey];
  if (dataArgument) {
    // config.experimental
    const unwrappedType = unwrapNamedType({ type: dataArgument.type });
    const name = unwrappedType.name;
    const inputType = typeMap[name];
    const inputValues = inputType.getFields();
    // get the input value AST definitions of the .data input object
    args = Object.values(inputValues).map(arg => arg.astNode);
    // use the .data key instead of the existing .params format
    paramKey = 'data';
    dataParams = dataParams[paramKey];
    // elevate .data to top level
    params.data = dataParams;
    // remove .params entry
    delete params.params;
  } else {
    dataParams = params.params;
  }
  // use apoc.create.uuid() to set a default value for @id field,
  // if no value for it is provided in dataParams
  statements = setPrimaryKeyValue({
    args,
    statements,
    params: dataParams,
    primaryKey
  });
  const paramStatements = buildCypherParameters({
    args,
    statements,
    params,
    paramKey,
    resolveInfo
  });
  createStatement = `CREATE (${safeVariableName}:${safeLabelName} {${paramStatements.join(
    ','
  )}})`;
  const [subQuery, subParams] = buildCypherSelection({
    selections,
    variableName,
    schemaType,
    resolveInfo,
    cypherParams: getCypherParams(context)
  });
  params = { ...params, ...subParams };
  const query = `
    ${createStatement}
    RETURN ${safeVariableName} {${subQuery}} AS ${safeVariableName}
  `;
  return [query, params];
};

export const nodeMergeOrUpdate = ({
  resolveInfo,
  variableName,
  typeName,
  selections,
  schemaType,
  additionalLabels,
  params,
  context,
  typeMap
}) => {
  const safeVariableName = safeVar(variableName);
  const args = getMutationArguments(resolveInfo);

  const selectionArgument = args.find(arg => arg.name.value === 'where');
  const dataArgument = args.find(arg => arg.name.value === 'data');

  const fieldMap = schemaType.getFields();
  const fields = Object.values(fieldMap).map(field => field.astNode);
  const primaryKey = getPrimaryKey({ fields });
  const primaryKeyArgName = primaryKey.name.value;

  let cypherOperation = '';
  let safeLabelName = safeLabel(typeName);
  if (isMergeMutation(resolveInfo)) {
    safeLabelName = safeLabel([typeName, ...additionalLabels]);
    cypherOperation = 'MERGE';
  } else if (isUpdateMutation(resolveInfo)) {
    cypherOperation = 'MATCH';
  }
  let query = ``;
  let paramUpdateStatements = [];
  if (selectionArgument && dataArgument) {
    // config.experimental
    // no need to use .params key in this argument design
    params = params.params;
    const [propertyStatements, generatePrimaryKey] = translateNodeInputArgument(
      {
        selectionArgument,
        dataArgument,
        params,
        primaryKey,
        typeMap,
        fieldMap,
        resolveInfo,
        context
      }
    );
    let onMatchStatements = ``;
    if (propertyStatements.length > 0) {
      onMatchStatements = `SET ${safeVar(
        variableName
      )} += {${propertyStatements.join(',')}} `;
    }
    if (isMergeMutation(resolveInfo)) {
      const unwrappedType = unwrapNamedType({ type: selectionArgument.type });
      const name = unwrappedType.name;
      const inputType = typeMap[name];
      const inputValues = inputType.getFields();
      const selectionArgs = Object.values(inputValues).map(arg => arg.astNode);
      const selectionExpression = buildCypherParameters({
        args: selectionArgs,
        params,
        paramKey: 'where',
        resolveInfo,
        cypherParams: getCypherParams(context)
      });
      // generatePrimaryKey is either empty or contains a call to apoc.create.uuid for @id key
      const onCreateProps = [...propertyStatements, ...generatePrimaryKey];
      let onCreateStatements = ``;
      if (onCreateProps.length > 0) {
        onCreateStatements = `SET ${safeVar(
          variableName
        )} += {${onCreateProps.join(',')}}`;
      }
      const keySelectionStatement = selectionExpression.join(',');
      query = `${cypherOperation} (${safeVariableName}:${safeLabelName}{${keySelectionStatement}})
ON CREATE
  ${onCreateStatements}
ON MATCH
  ${onMatchStatements}`;
    } else {
      const [predicate, serializedFilter] = translateNodeSelectionArgument({
        variableName,
        args,
        params,
        schemaType,
        resolveInfo
      });
      query = `${cypherOperation} (${safeVariableName}:${safeLabelName})${predicate}
${onMatchStatements}\n`;
      params = { ...params, ...serializedFilter };
    }
  } else {
    const [primaryKeyParam, updateParams] = splitSelectionParameters(
      params,
      primaryKeyArgName,
      'params'
    );
    paramUpdateStatements = buildCypherParameters({
      args,
      params: updateParams,
      paramKey: 'params',
      resolveInfo,
      cypherParams: getCypherParams(context)
    });
    query = `${cypherOperation} (${safeVariableName}:${safeLabelName}{${primaryKeyArgName}: $params.${primaryKeyArgName}})
  `;
    if (paramUpdateStatements.length > 0) {
      query += `SET ${safeVariableName} += {${paramUpdateStatements.join(
        ','
      )}} `;
    }
    if (!params.params) params.params = {};
    params.params[primaryKeyArgName] = primaryKeyParam[primaryKeyArgName];
  }
  const [subQuery, subParams] = buildCypherSelection({
    selections,
    variableName,
    schemaType,
    resolveInfo,
    cypherParams: getCypherParams(context)
  });
  params = { ...params, ...subParams };
  query += `RETURN ${safeVariableName} {${subQuery}} AS ${safeVariableName}`;
  return [query, params];
};

export const nodeDelete = ({
  resolveInfo,
  selections,
  variableName,
  typeName,
  schemaType,
  params
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel(typeName);
  const args = getMutationArguments(resolveInfo);
  const fieldMap = schemaType.getFields();
  const fields = Object.values(fieldMap).map(field => field.astNode);
  const primaryKey = getPrimaryKey({ fields });
  const primaryKeyArgName = primaryKey.name.value;
  let matchStatement = ``;
  const selectionArgument = args.find(arg => arg.name.value === 'where');
  if (selectionArgument) {
    const [predicate, serializedFilter] = translateNodeSelectionArgument({
      variableName,
      args,
      params,
      schemaType,
      resolveInfo
    });
    matchStatement = `MATCH (${safeVariableName}:${safeLabelName})${predicate}`;
    params = { ...params, ...serializedFilter };
  } else {
    matchStatement = `MATCH (${safeVariableName}:${safeLabelName} {${primaryKeyArgName}: $${primaryKeyArgName}})`;
  }
  const [subQuery, subParams] = buildCypherSelection({
    selections,
    variableName,
    schemaType,
    resolveInfo
  });
  params = { ...params, ...subParams };
  const deletionVariableName = safeVar(`${variableName}_toDelete`);
  // Cannot execute a map projection on a deleted node in Neo4j
  // so the projection is executed and aliased before the delete
  const query = `${matchStatement}
WITH ${safeVariableName} AS ${deletionVariableName}, ${safeVariableName} {${subQuery}} AS ${safeVariableName}
DETACH DELETE ${deletionVariableName}
RETURN ${safeVariableName}`;
  return [query, params];
};

export const translateNodeInputArgument = ({
  selectionArgument = {},
  dataArgument = {},
  params,
  primaryKey,
  typeMap,
  resolveInfo,
  context
}) => {
  const unwrappedType = unwrapNamedType({ type: dataArgument.type });
  const name = unwrappedType.name;
  const inputType = typeMap[name];
  const inputValues = inputType.getFields();
  const updateArgs = Object.values(inputValues).map(arg => arg.astNode);
  let propertyStatements = buildCypherParameters({
    args: updateArgs,
    params,
    paramKey: 'data',
    resolveInfo,
    cypherParams: getCypherParams(context)
  });
  let primaryKeyStatement = [];
  if (isMergeMutation(resolveInfo)) {
    const unwrappedType = unwrapNamedType({ type: selectionArgument.type });
    const name = unwrappedType.name;
    const inputType = typeMap[name];
    const inputValues = inputType.getFields();
    const selectionArgs = Object.values(inputValues).map(arg => arg.astNode);
    // check key selection values for @id key argument
    const primaryKeySelectionValue = setPrimaryKeyValue({
      args: selectionArgs,
      params: params['where'],
      primaryKey
    });
    const primaryKeyValue = setPrimaryKeyValue({
      args: updateArgs,
      params: params['data'],
      primaryKey
    });
    if (primaryKeySelectionValue.length && primaryKeyValue.length) {
      // apoc.create.uuid() statement returned for both, so a value exists in neither
      primaryKeyStatement = primaryKeySelectionValue;
    }
  }
  return [propertyStatements, primaryKeyStatement];
};

export const translateNodeSelectionArgument = ({
  variableName,
  args,
  params,
  schemaType,
  resolveInfo
}) => {
  const [filterPredicates, serializedFilter] = processFilterArgument({
    argumentName: 'where',
    fieldArgs: args,
    schemaType,
    variableName,
    resolveInfo,
    params
  });
  const predicateClauses = [...filterPredicates]
    .filter(predicate => !!predicate)
    .join(' AND ');
  let predicate = ``;
  if (isMergeMutation(resolveInfo)) {
    predicate = predicateClauses;
  } else {
    predicate = predicateClauses ? ` WHERE ${predicateClauses} ` : '';
  }
  return [predicate, serializedFilter];
};

// Relation Add / Remove
export const relationshipCreate = ({
  resolveInfo,
  selections,
  schemaType,
  params,
  context
}) => {
  let mutationMeta, relationshipNameArg, fromTypeArg, toTypeArg;
  try {
    mutationMeta = resolveInfo.schema
      .getMutationType()
      .getFields()
      [resolveInfo.fieldName].astNode.directives.find(x => {
        return x.name.value === 'MutationMeta';
      });
  } catch (e) {
    throw new Error(
      'Missing required MutationMeta directive on add relationship directive'
    );
  }
  try {
    relationshipNameArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'relationship';
    });
    fromTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'from';
    });
    toTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'to';
    });
  } catch (e) {
    throw new Error(
      'Missing required argument in MutationMeta directive (relationship, from, or to)'
    );
  }

  const schemaTypeName = safeVar(schemaType);
  const cypherParams = getCypherParams(context);

  const args = getMutationArguments(resolveInfo);
  const typeMap = resolveInfo.schema.getTypeMap();

  const fromType = fromTypeArg.value.value;
  const fromSchemaType = resolveInfo.schema.getType(fromType);
  const fromAdditionalLabels = getAdditionalLabels(
    fromSchemaType,
    cypherParams
  );
  const fromLabel = safeLabel([fromType, ...fromAdditionalLabels]);
  const firstArg = args[0];
  const fromArgName = firstArg.name.value;
  const fromVar = `${lowFirstLetter(fromType)}_${fromArgName}`;
  const fromVariable = safeVar(fromVar);
  const fromInputArg = firstArg.type;
  const fromInputArgType = getNamedType(fromInputArg).type.name.value;
  const fromInputAst = typeMap[fromInputArgType].astNode;
  const fromFields = fromInputAst.fields;
  const fromCypherParam = fromFields[0].name.value;

  const toType = toTypeArg.value.value;
  const toSchemaType = resolveInfo.schema.getType(toType);
  const toAdditionalLabels = getAdditionalLabels(toSchemaType, cypherParams);
  const toLabel = safeLabel([toType, ...toAdditionalLabels]);
  const secondArg = args[1];
  const toArgName = secondArg.name.value;
  const toVar = `${lowFirstLetter(toType)}_${toArgName}`;
  const toVariable = safeVar(toVar);
  const toInputArg = secondArg.type;
  const toInputArgType = getNamedType(toInputArg).type.name.value;
  const toInputAst = typeMap[toInputArgType].astNode;
  const toFields = toInputAst.fields;
  const toCypherParam = toFields[0].name.value;

  const relationshipName = relationshipNameArg.value.value;
  const lowercased = relationshipName.toLowerCase();
  const relationshipLabel = safeLabel(relationshipName);
  const relationshipVariable = safeVar(lowercased + '_relation');

  const dataInputArg = args.find(e => e.name.value === 'data');
  const dataInputAst = dataInputArg
    ? typeMap[getNamedType(dataInputArg.type).type.name.value].astNode
    : undefined;
  const dataFields = dataInputAst ? dataInputAst.fields : [];
  const [subQuery, subParams] = buildCypherSelection({
    selections,
    schemaType,
    resolveInfo,
    parentSelectionInfo: {
      fromArgName,
      toArgName,
      [fromArgName]: fromVar,
      [toArgName]: toVar,
      variableName: lowercased
    },
    cypherParams: getCypherParams(context)
  });
  let nodeSelectionStatements = ``;
  const fromUsesWhereInput =
    fromInputArgType.startsWith('_') && fromInputArgType.endsWith('Where');
  const toUsesWhereInput =
    toInputArgType.startsWith('_') && toInputArgType.endsWith('Where');
  if (fromUsesWhereInput && toUsesWhereInput) {
    const [fromPredicate, serializedFromFilter] = processFilterArgument({
      argumentName: fromArgName,
      variableName: fromVar,
      schemaType: fromSchemaType,
      fieldArgs: args,
      resolveInfo,
      params
    });
    const fromClauses = [...fromPredicate]
      .filter(predicate => !!predicate)
      .join(' AND ');
    const [toPredicate, serializedToFilter] = processFilterArgument({
      argumentName: toArgName,
      variableName: toVar,
      schemaType: toSchemaType,
      fieldArgs: args,
      resolveInfo,
      params
    });
    const toClauses = [...toPredicate]
      .filter(predicate => !!predicate)
      .join(' AND ');
    const sourceNodeSelectionPredicate = fromClauses
      ? ` WHERE ${fromClauses} `
      : '';
    const targetNodeSelectionPredicate = toClauses
      ? ` WHERE ${toClauses} `
      : '';
    params = { ...params, ...serializedFromFilter };
    params = { ...params, ...serializedToFilter };
    nodeSelectionStatements = `MATCH (${fromVariable}:${fromLabel})${sourceNodeSelectionPredicate}
      MATCH (${toVariable}:${toLabel})${targetNodeSelectionPredicate}`;
  } else {
    nodeSelectionStatements = `MATCH (${fromVariable}:${fromLabel} {${fromCypherParam}: $${fromArgName}.${fromCypherParam}})
      MATCH (${toVariable}:${toLabel} {${toCypherParam}: $${toArgName}.${toCypherParam}})`;
  }
  const paramStatements = buildCypherParameters({
    args: dataFields,
    params,
    paramKey: 'data',
    resolveInfo
  });
  params = { ...params, ...subParams };
  let query = `
      ${nodeSelectionStatements}
      CREATE (${fromVariable})-[${relationshipVariable}:${relationshipLabel}${
    paramStatements.length > 0 ? ` {${paramStatements.join(',')}}` : ''
  }]->(${toVariable})
      RETURN ${relationshipVariable} { ${subQuery} } AS ${schemaTypeName};
    `;
  return [query, params];
};

export const relationshipDelete = ({
  resolveInfo,
  selections,
  schemaType,
  params,
  context
}) => {
  let mutationMeta, relationshipNameArg, fromTypeArg, toTypeArg;
  try {
    mutationMeta = resolveInfo.schema
      .getMutationType()
      .getFields()
      [resolveInfo.fieldName].astNode.directives.find(x => {
        return x.name.value === 'MutationMeta';
      });
  } catch (e) {
    throw new Error(
      'Missing required MutationMeta directive on add relationship directive'
    );
  }

  try {
    relationshipNameArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'relationship';
    });
    fromTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'from';
    });
    toTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'to';
    });
  } catch (e) {
    throw new Error(
      'Missing required argument in MutationMeta directive (relationship, from, or to)'
    );
  }

  const schemaTypeName = safeVar(schemaType);
  const cypherParams = getCypherParams(context);

  const args = getMutationArguments(resolveInfo);
  const typeMap = resolveInfo.schema.getTypeMap();

  const fromType = fromTypeArg.value.value;
  const fromSchemaType = resolveInfo.schema.getType(fromType);
  const fromAdditionalLabels = getAdditionalLabels(
    resolveInfo.schema.getType(fromType),
    cypherParams
  );
  const fromLabel = safeLabel([fromType, ...fromAdditionalLabels]);
  const firstArg = args[0];
  const fromArgName = firstArg.name.value;
  const fromVar = `${lowFirstLetter(fromType)}_${fromArgName}`;
  const fromVariable = safeVar(fromVar);
  const fromInputArg = firstArg.type;
  const fromInputArgType = getNamedType(fromInputArg).type.name.value;
  const fromInputAst = typeMap[fromInputArgType].astNode;
  const fromFields = fromInputAst.fields;
  const fromCypherParam = fromFields[0].name.value;

  const toType = toTypeArg.value.value;
  const toSchemaType = resolveInfo.schema.getType(toType);
  const toAdditionalLabels = getAdditionalLabels(
    resolveInfo.schema.getType(toType),
    cypherParams
  );
  const toLabel = safeLabel([toType, ...toAdditionalLabels]);
  const secondArg = args[1];
  const toArgName = secondArg.name.value;
  const toVar = `${lowFirstLetter(toType)}_${toArgName}`;
  const toVariable = safeVar(toVar);

  const toInputArg = secondArg.type;
  const toInputArgType = getNamedType(toInputArg).type.name.value;
  const toInputAst = typeMap[toInputArgType].astNode;
  const toFields = toInputAst.fields;
  const toCypherParam = toFields[0].name.value;

  const relationshipName = relationshipNameArg.value.value;
  const relationshipVariable = safeVar(fromVar + toVar);
  const relationshipLabel = safeLabel(relationshipName);
  let nodeSelectionStatements = ``;
  const fromUsesWhereInput =
    fromInputArgType.startsWith('_') && fromInputArgType.endsWith('Where');
  const toUsesWhereInput =
    toInputArgType.startsWith('_') && toInputArgType.endsWith('Where');
  if (fromUsesWhereInput && toUsesWhereInput) {
    const [fromPredicate, serializedFromFilter] = processFilterArgument({
      argumentName: fromArgName,
      variableName: fromVar,
      schemaType: fromSchemaType,
      fieldArgs: args,
      resolveInfo,
      params
    });
    const fromClauses = [...fromPredicate]
      .filter(predicate => !!predicate)
      .join(' AND ');
    const [toPredicate, serializedToFilter] = processFilterArgument({
      argumentName: toArgName,
      variableName: toVar,
      schemaType: toSchemaType,
      fieldArgs: args,
      resolveInfo,
      params
    });
    const toClauses = [...toPredicate]
      .filter(predicate => !!predicate)
      .join(' AND ');
    const sourceNodeSelectionPredicate = fromClauses
      ? ` WHERE ${fromClauses} `
      : '';
    const targetNodeSelectionPredicate = toClauses
      ? ` WHERE ${toClauses} `
      : '';
    params = { ...params, ...serializedFromFilter };
    params = { ...params, ...serializedToFilter };
    nodeSelectionStatements = `MATCH (${fromVariable}:${fromLabel})${sourceNodeSelectionPredicate}
      MATCH (${toVariable}:${toLabel})${targetNodeSelectionPredicate}`;
  } else {
    nodeSelectionStatements = `MATCH (${fromVariable}:${fromLabel} {${fromCypherParam}: $${fromArgName}.${fromCypherParam}})
      MATCH (${toVariable}:${toLabel} {${toCypherParam}: $${toArgName}.${toCypherParam}})`;
  }

  const [subQuery, subParams] = buildCypherSelection({
    selections,
    schemaType,
    resolveInfo,
    parentSelectionInfo: {
      fromArgName,
      toArgName,
      [fromArgName]: '_' + fromVar,
      [toArgName]: '_' + toVar
    },
    cypherParams: getCypherParams(context)
  });
  const query = `
      ${nodeSelectionStatements}
      OPTIONAL MATCH (${fromVariable})-[${relationshipVariable}:${relationshipLabel}]->(${toVariable})
      DELETE ${relationshipVariable}
      WITH COUNT(*) AS scope, ${fromVariable} AS ${safeVar(
    `_${fromVar}`
  )}, ${toVariable} AS ${safeVar(`_${toVar}`)}
      RETURN {${subQuery}} AS ${schemaTypeName};
    `;
  params = { ...params, ...subParams };
  return [query, params];
};

export const relationshipMergeOrUpdate = ({
  mutationMeta,
  resolveInfo,
  selections,
  schemaType,
  params,
  context
}) => {
  let query = '';
  let relationshipNameArg = undefined;
  let fromTypeArg = undefined;
  let toTypeArg = undefined;
  try {
    relationshipNameArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'relationship';
    });
    fromTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'from';
    });
    toTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'to';
    });
  } catch (e) {
    throw new Error(
      'Missing required argument in MutationMeta directive (relationship, from, or to)'
    );
  }
  if (relationshipNameArg && fromTypeArg && toTypeArg) {
    const schemaTypeName = safeVar(schemaType);
    const cypherParams = getCypherParams(context);

    const args = getMutationArguments(resolveInfo);
    const typeMap = resolveInfo.schema.getTypeMap();

    const fromType = fromTypeArg.value.value;
    const fromSchemaType = resolveInfo.schema.getType(fromType);
    const fromAdditionalLabels = getAdditionalLabels(
      resolveInfo.schema.getType(fromType),
      cypherParams
    );
    const fromLabel = safeLabel([fromType, ...fromAdditionalLabels]);
    const firstArg = args[0];
    const fromArgName = firstArg.name.value;
    const fromVar = `${lowFirstLetter(fromType)}_${fromArgName}`;
    const fromVariable = safeVar(fromVar);
    const fromInputArg = firstArg.type;
    const fromInputArgType = getNamedType(fromInputArg).type.name.value;
    const fromInputAst = typeMap[fromInputArgType].astNode;
    const fromFields = fromInputAst.fields;
    const fromCypherParam = fromFields[0].name.value;

    const toType = toTypeArg.value.value;
    const toSchemaType = resolveInfo.schema.getType(toType);
    const toAdditionalLabels = getAdditionalLabels(
      resolveInfo.schema.getType(toType),
      cypherParams
    );
    const toLabel = safeLabel([toType, ...toAdditionalLabels]);
    const secondArg = args[1];
    const toArgName = secondArg.name.value;
    const toVar = `${lowFirstLetter(toType)}_${toArgName}`;
    const toVariable = safeVar(toVar);
    const toInputArg = secondArg.type;
    const toInputArgType = getNamedType(toInputArg).type.name.value;
    const toInputAst = typeMap[toInputArgType].astNode;
    const toFields = toInputAst.fields;
    const toCypherParam = toFields[0].name.value;

    const relationshipName = relationshipNameArg.value.value;
    const lowercased = relationshipName.toLowerCase();
    const relationshipLabel = safeLabel(relationshipName);
    const relationshipVariable = safeVar(lowercased + '_relation');

    const dataInputArg = args.find(e => e.name.value === 'data');
    const dataInputAst = dataInputArg
      ? typeMap[getNamedType(dataInputArg.type).type.name.value].astNode
      : undefined;
    const dataFields = dataInputAst ? dataInputAst.fields : [];

    let nodeSelectionStatements = ``;
    const fromUsesWhereInput =
      fromInputArgType.startsWith('_') && fromInputArgType.endsWith('Where');
    const toUsesWhereInput =
      toInputArgType.startsWith('_') && toInputArgType.endsWith('Where');
    if (fromUsesWhereInput && toUsesWhereInput) {
      const [fromPredicate, serializedFromFilter] = processFilterArgument({
        argumentName: fromArgName,
        variableName: fromVar,
        schemaType: fromSchemaType,
        fieldArgs: args,
        resolveInfo,
        params
      });
      const fromClauses = [...fromPredicate]
        .filter(predicate => !!predicate)
        .join(' AND ');
      const [toPredicate, serializedToFilter] = processFilterArgument({
        argumentName: toArgName,
        variableName: toVar,
        schemaType: toSchemaType,
        fieldArgs: args,
        resolveInfo,
        params
      });
      const toClauses = [...toPredicate]
        .filter(predicate => !!predicate)
        .join(' AND ');
      const sourceNodeSelectionPredicate = fromClauses
        ? ` WHERE ${fromClauses} `
        : '';
      const targetNodeSelectionPredicate = toClauses
        ? ` WHERE ${toClauses} `
        : '';
      params = { ...params, ...serializedFromFilter };
      params = { ...params, ...serializedToFilter };
      nodeSelectionStatements = `  MATCH (${fromVariable}:${fromLabel})${sourceNodeSelectionPredicate}
      MATCH (${toVariable}:${toLabel})${targetNodeSelectionPredicate}`;
    } else {
      nodeSelectionStatements = `  MATCH (${fromVariable}:${fromLabel} {${fromCypherParam}: $${fromArgName}.${fromCypherParam}})
      MATCH (${toVariable}:${toLabel} {${toCypherParam}: $${toArgName}.${toCypherParam}})`;
    }

    const [subQuery, subParams] = buildCypherSelection({
      selections,
      schemaType,
      resolveInfo,
      parentSelectionInfo: {
        fromArgName,
        toArgName,
        [fromArgName]: fromVar,
        [toArgName]: toVar,
        variableName: lowercased
      },
      cypherParams: getCypherParams(context)
    });

    const paramStatements = buildCypherParameters({
      args: dataFields,
      params,
      paramKey: 'data',
      resolveInfo
    });

    let cypherOperation = '';
    if (isMergeMutation(resolveInfo)) {
      cypherOperation = 'MERGE';
    } else if (isUpdateMutation(resolveInfo)) {
      cypherOperation = 'MATCH';
    }

    query = `
    ${nodeSelectionStatements}
      ${cypherOperation} (${fromVariable})-[${relationshipVariable}:${relationshipLabel}]->(${toVariable})${
      paramStatements.length > 0
        ? `
      SET ${relationshipVariable} += {${paramStatements.join(',')}} `
        : ''
    }
      RETURN ${relationshipVariable} { ${subQuery} } AS ${schemaTypeName};
    `;
    params = { ...params, ...subParams };
  }
  return [query, params];
};

export const translateNestedOrderingArgument = ({
  schemaType,
  selections,
  fieldSelectionSet,
  filterParams
}) => {
  const orderByParam = filterParams['orderBy'];
  const usesTemporalOrdering = temporalOrderingFieldExists(
    schemaType,
    filterParams
  );
  const selectedFieldNames = fieldSelectionSet.reduce((fieldNames, field) => {
    if (field.name) fieldNames.push(field.name.value);
    return fieldNames;
  }, []);
  let neo4jTypeFieldSelections = '';
  if (usesTemporalOrdering) {
    neo4jTypeFieldSelections = selections
      .reduce((temporalTypeFields, innerSelection) => {
        // name of temporal type field
        const fieldName = innerSelection.name.value;
        const fieldTypeName = getFieldTypeName(schemaType, fieldName);
        const fieldIsSelected = selectedFieldNames.some(
          name => name === fieldName
        );
        const isTemporalTypeField = isTemporalType(fieldTypeName);
        if (isTemporalTypeField && fieldIsSelected) {
          const innerSelectedTypes = innerSelection.selectionSet
            ? innerSelection.selectionSet.selections
            : [];
          temporalTypeFields.push(
            `${fieldName}: {${innerSelectedTypes
              .reduce((temporalSubFields, t) => {
                // temporal type subfields, year, minute, etc.
                const subFieldName = t.name.value;
                if (subFieldName === 'formatted') {
                  temporalSubFields.push(
                    `${subFieldName}: toString(sortedElement.${fieldName})`
                  );
                } else {
                  temporalSubFields.push(
                    `${subFieldName}: sortedElement.${fieldName}.${subFieldName}`
                  );
                }
                return temporalSubFields;
              }, [])
              .join(',')}}`
          );
        }
        return temporalTypeFields;
      }, [])
      .join(',');
  }
  const lhsOrdering = orderByParam
    ? usesTemporalOrdering
      ? `[sortedElement IN apoc.coll.sortMulti(`
      : `apoc.coll.sortMulti(`
    : '';
  const rhsOrdering = orderByParam
    ? `, [${buildSortMultiArgs(orderByParam)}])${
        usesTemporalOrdering
          ? ` | sortedElement { .* ${
              neo4jTypeFieldSelections ? `,  ${neo4jTypeFieldSelections}` : ''
            }}]`
          : ``
      }`
    : '';
  return [lhsOrdering, rhsOrdering];
};

export const getFieldTypeName = (schemaType, fieldName) => {
  const field =
    schemaType && fieldName ? schemaType.getFields()[fieldName] : undefined;
  return field ? field.type.name : '';
};

export const temporalOrderingFieldExists = (schemaType, filterParams) => {
  let orderByParam = filterParams ? filterParams['orderBy'] : undefined;
  if (orderByParam) {
    orderByParam = orderByParam.value;
    if (!Array.isArray(orderByParam)) orderByParam = [orderByParam];
    return orderByParam.find(e => {
      const fieldName = e.substring(0, e.lastIndexOf('_'));
      const fieldTypeName = getFieldTypeName(schemaType, fieldName);
      return isTemporalType(fieldTypeName);
    });
  }
  return undefined;
};

export const buildSortMultiArgs = param => {
  let values = param ? param.value : [];
  let fieldName = '';
  if (!Array.isArray(values)) values = [values];
  return values
    .map(e => {
      fieldName = e.substring(0, e.lastIndexOf('_'));
      return e.includes('_asc') ? `'^${fieldName}'` : `'${fieldName}'`;
    })
    .join(',');
};

export const processFilterArgument = ({
  argumentName = 'filter',
  fieldArgs,
  isFederatedOperation,
  schemaType,
  variableName,
  resolveInfo,
  params,
  paramIndex,
  parentSchemaType,
  rootIsRelationType = false
}) => {
  const filterArg = fieldArgs.find(e => e.name.value === argumentName);
  const filterValue = Object.keys(params).length
    ? params[argumentName]
    : undefined;
  const filterParamKey =
    paramIndex > 1 ? `${paramIndex - 1}_${argumentName}` : argumentName;
  const filterCypherParam = `$${filterParamKey}`;
  let translations = [];
  // allows an exception for the existence of the filter argument AST
  // if isFederatedOperation
  if ((filterArg || isFederatedOperation) && filterValue) {
    // if field has both a filter argument and argument data is provided
    const schema = resolveInfo.schema;
    let serializedFilterParam = filterValue;
    let filterFieldMap = {};
    [filterFieldMap, serializedFilterParam] = analyzeFilterArguments({
      filterValue,
      variableName,
      filterCypherParam,
      schemaType,
      schema
    });
    translations = translateFilterArguments({
      filterValue,
      filterFieldMap,
      filterCypherParam,
      rootIsRelationType,
      variableName,
      schemaType,
      parentSchemaType,
      schema
    });
    params = {
      ...params,
      [filterParamKey]: serializedFilterParam
    };
  }
  return [translations, params];
};

export const analyzeFilterArguments = ({
  filterValue,
  variableName,
  filterCypherParam,
  schemaType,
  schema
}) => {
  return Object.entries(filterValue).reduce(
    ([filterFieldMap, serializedParams], [name, value]) => {
      const filterParamName = serializeFilterFieldName(name, value);
      const [serializedValue, fieldMap] = analyzeFilterArgument({
        filterValue: value,
        filterValues: filterValue,
        fieldName: name,
        filterParam: filterCypherParam,
        variableName,
        schemaType,
        schema
      });
      filterFieldMap[filterParamName] = fieldMap;
      serializedParams[filterParamName] = serializedValue;
      return [filterFieldMap, serializedParams];
    },
    [{}, {}]
  );
};

export const analyzeFilterArgument = ({
  parentFieldName,
  filterValue,
  fieldName,
  variableName,
  filterParam,
  parentSchemaType,
  schemaType,
  schema
}) => {
  const parsedFilterName = parseFilterArgumentName(fieldName);
  let filterOperationField = parsedFilterName.name;
  let filterOperationType = parsedFilterName.type;
  // defaults
  let filterMapValue = true;
  let serializedFilterParam = filterValue;
  let innerSchemaType = schemaType;
  let typeName = schemaType.name;
  if (filterOperationField !== 'OR' && filterOperationField !== 'AND') {
    const schemaTypeFields = schemaType.getFields();
    const filterField = schemaTypeFields[filterOperationField];
    const filterFieldAst = filterField.astNode;
    const filterType = filterFieldAst.type;
    const innerFieldType = unwrapNamedType({ type: filterType });
    typeName = innerFieldType.name;
    innerSchemaType = schema.getType(typeName);
  }
  if (isScalarType(innerSchemaType) || isEnumType(innerSchemaType)) {
    if (isExistentialFilter(filterOperationType, filterValue)) {
      serializedFilterParam = true;
      filterMapValue = null;
    }
  } else if (
    isObjectType(innerSchemaType) ||
    isInterfaceType(innerSchemaType)
  ) {
    if (fieldName === 'AND' || fieldName === 'OR') {
      // recursion
      [serializedFilterParam, filterMapValue] = analyzeNestedFilterArgument({
        filterValue,
        filterOperationType,
        parentFieldName: fieldName,
        parentSchemaType: schemaType,
        schemaType,
        variableName,
        filterParam,
        schema
      });
    } else {
      const schemaTypeField = schemaType.getFields()[filterOperationField];
      const innerSchemaType = innerType(schemaTypeField.type);
      const isObjectTypeFilter = isObjectType(innerSchemaType);
      const isInterfaceTypeFilter = isInterfaceType(innerSchemaType);
      if (isObjectTypeFilter || isInterfaceTypeFilter) {
        const [
          thisType,
          relatedType,
          relationLabel,
          relationDirection,
          isRelation,
          isRelationType,
          isRelationTypeNode,
          isReflexiveRelationType,
          isReflexiveTypeDirectedField
        ] = decideRelationFilterMetadata({
          fieldName,
          parentSchemaType,
          schemaType,
          variableName,
          innerSchemaType,
          filterOperationField
        });
        if (isReflexiveTypeDirectedField) {
          // for the 'from' and 'to' fields on the payload of a reflexive
          // relation type to use the parent field name, ex: 'knows_some'
          // is used for 'from' and 'to' in 'knows_some: { from: {}, to: {} }'
          const parsedFilterName = parseFilterArgumentName(parentFieldName);
          filterOperationField = parsedFilterName.name;
          filterOperationType = parsedFilterName.type;
        }
        if (isExistentialFilter(filterOperationType, filterValue)) {
          serializedFilterParam = true;
          filterMapValue = null;
        } else if (
          isTemporalType(typeName) ||
          isSpatialType(typeName) ||
          isSpatialDistanceInputType({
            filterOperationType
          })
        ) {
          [serializedFilterParam, filterMapValue] = analyzeNeo4jTypeFilter({
            typeName,
            filterOperationType,
            filterValue,
            parentFieldName
          });
        } else if (isRelation || isRelationType || isRelationTypeNode) {
          // recursion
          [serializedFilterParam, filterMapValue] = analyzeNestedFilterArgument(
            {
              filterValue,
              filterOperationType,
              isRelationType,
              parentFieldName: fieldName,
              parentSchemaType: schemaType,
              schemaType: innerSchemaType,
              variableName,
              filterParam,
              schema
            }
          );
        }
      }
    }
  }
  return [serializedFilterParam, filterMapValue];
};

export const analyzeNeo4jTypeFilter = ({
  typeName,
  filterOperationType,
  filterValue,
  parentFieldName
}) => {
  let filterMapValue = {};
  const isListFilterArgument =
    filterOperationType === 'in' || filterOperationType === 'not_in';
  if (isListFilterArgument) {
    filterMapValue = filterValue.reduce((booleanMap, filter) => {
      Object.keys(filter).forEach(key => {
        booleanMap[key] = true;
      });
      return booleanMap;
    }, {});
  } else {
    filterMapValue = Object.keys(filterValue).reduce((booleanMap, key) => {
      booleanMap[key] = true;
      return booleanMap;
    }, {});
  }
  let serializedFilterParam = filterValue;
  if (
    !isSpatialDistanceInputType({ filterOperationType }) &&
    !isSpatialType(typeName)
  ) {
    serializedFilterParam = serializeNeo4jTypeParam({
      filterValue,
      filterOperationType,
      parentFieldName
    });
  }
  return [serializedFilterParam, filterMapValue];
};

export const analyzeNestedFilterArgument = ({
  parentSchemaType,
  parentFieldName,
  schemaType,
  variableName,
  filterValue,
  filterParam,
  schema
}) => {
  const isList = Array.isArray(filterValue);
  // coersion to array for dynamic iteration of objects and arrays
  if (!isList) filterValue = [filterValue];
  let serializedFilterValue = [];
  let filterValueFieldMap = {};
  filterValue.forEach(filter => {
    let serializedValues = {};
    let serializedValue = {};
    let valueFieldMap = {};
    Object.entries(filter).forEach(([fieldName, value]) => {
      fieldName = deserializeFilterFieldName(fieldName);
      [serializedValue, valueFieldMap] = analyzeFilterArgument({
        parentFieldName,
        filterValue: value,
        filterValues: filter,
        fieldName,
        variableName,
        filterParam,
        parentSchemaType,
        schemaType,
        schema
      });
      const filterParamName = serializeFilterFieldName(fieldName, value);
      const filterMapEntry = filterValueFieldMap[filterParamName];
      if (!filterMapEntry) filterValueFieldMap[filterParamName] = valueFieldMap;
      // deep merges in order to capture differences in objects within nested array filters
      else
        filterValueFieldMap[filterParamName] = _.merge(
          filterMapEntry,
          valueFieldMap
        );
      serializedValues[filterParamName] = serializedValue;
    });
    serializedFilterValue.push(serializedValues);
  });
  // undo array coersion
  if (!isList) serializedFilterValue = serializedFilterValue[0];
  return [serializedFilterValue, filterValueFieldMap];
};

export const serializeFilterFieldName = (name, value) => {
  if (value === null) {
    const parsedFilterName = parseFilterArgumentName(name);
    const filterOperationType = parsedFilterName.type;
    if (!filterOperationType || filterOperationType === 'not') {
      return `_${name}_null`;
    }
  }
  return name;
};

export const serializeNeo4jTypeParam = ({
  filterValue,
  filterOperationType,
  parentFieldName
}) => {
  const isList = Array.isArray(filterValue);
  if (!isList) filterValue = [filterValue];
  let serializedValues = filterValue.reduce((serializedValues, filter) => {
    let serializedValue = {};
    if (
      filter['formatted'] &&
      parentFieldName !== 'OR' &&
      parentFieldName !== 'AND' &&
      filterOperationType !== 'in' &&
      filterOperationType !== 'not_in' &&
      !isList
    ) {
      serializedValue = filter['formatted'];
    } else {
      serializedValue = Object.entries(filter).reduce(
        (serialized, [key, value]) => {
          if (Number.isInteger(value)) {
            value = neo4j.int(value);
          }
          serialized[key] = value;
          return serialized;
        },
        {}
      );
    }
    serializedValues.push(serializedValue);
    return serializedValues;
  }, []);
  if (!isList) serializedValues = serializedValues[0];
  return serializedValues;
};

export const deserializeFilterFieldName = name => {
  if (name.startsWith('_') && name.endsWith('_null')) {
    name = name.substring(1, name.length - 5);
  }
  return name;
};

export const translateFilterArguments = ({
  filterValue,
  filterFieldMap,
  filterCypherParam,
  variableName,
  rootIsRelationType,
  schemaType,
  parentSchemaType,
  schema
}) => {
  return Object.entries(filterFieldMap).reduce(
    (translations, [name, value]) => {
      // the filter field map uses serialized field names to allow for both field: {} and field: null
      name = deserializeFilterFieldName(name);
      const translation = translateFilterArgument({
        filterParam: filterCypherParam,
        fieldName: name,
        filterValue: value,
        paramValue: filterValue,
        rootIsRelationType,
        variableName,
        schemaType,
        parentSchemaType,
        schema
      });
      if (translation) {
        translations.push(`(${translation})`);
      }
      return translations;
    },
    []
  );
};

export const translateFilterArgument = ({
  parentParamPath,
  parentFieldName,
  isListFilterArgument = false,
  filterValue,
  paramValue,
  fieldName,
  rootIsRelationType,
  variableName,
  filterParam,
  schemaType,
  parentSchemaType,
  schema
}) => {
  // parse field name into prefix (ex: name, company) and
  // possible suffix identifying operation type (ex: _gt, _in)
  const parsedFilterName = parseFilterArgumentName(fieldName);
  const filterOperationField = parsedFilterName.name;
  const filterOperationType = parsedFilterName.type;
  let innerSchemaType = schemaType;
  let typeName = schemaType.name;
  let innerFieldType = {};
  let isListFieldFilter = false;
  if (filterOperationField !== 'OR' && filterOperationField !== 'AND') {
    const schemaTypeFields = schemaType.getFields();
    const filterField = schemaTypeFields[filterOperationField];
    const filterFieldAst = filterField.astNode;
    const filterType = filterFieldAst.type;
    innerFieldType = unwrapNamedType({ type: filterType });
    if (innerFieldType.wrappers[TypeWrappers.LIST_TYPE]) {
      isListFieldFilter = true;
    }
    typeName = innerFieldType.name;
    innerSchemaType = schema.getType(typeName);
  }
  // build path for parameter data for current filter field
  const parameterPath = `${
    parentParamPath ? parentParamPath : filterParam
  }.${fieldName}`;
  // short-circuit evaluation: predicate used to skip a field
  // if processing a list of objects that possibly contain different arguments
  const nullFieldPredicate = decideNullSkippingPredicate({
    parameterPath,
    isListFilterArgument,
    parentParamPath
  });
  let translation = '';
  if (isScalarType(innerSchemaType) || isEnumType(innerSchemaType)) {
    translation = translateScalarFilter({
      typeName,
      isListFilterArgument,
      isListFieldFilter,
      filterOperationField,
      filterOperationType,
      filterValue,
      paramValue,
      fieldName,
      variableName,
      parameterPath,
      parentParamPath,
      filterParam,
      nullFieldPredicate
    });
  } else if (
    isObjectType(innerSchemaType) ||
    isInterfaceType(innerSchemaType)
  ) {
    translation = translateInputFilter({
      rootIsRelationType,
      isListFilterArgument,
      isListFieldFilter,
      filterOperationField,
      filterOperationType,
      filterValue,
      paramValue,
      variableName,
      fieldName,
      filterParam,
      schema,
      parentSchemaType,
      schemaType,
      parameterPath,
      parentParamPath,
      parentFieldName,
      nullFieldPredicate
    });
  }
  return translation;
};

export const parseFilterArgumentName = fieldName => {
  const fieldNameParts = fieldName.split('_');

  const filterTypes = [
    '_not',
    '_in',
    '_not_in',
    '_contains',
    '_not_contains',
    '_starts_with',
    '_not_starts_with',
    '_ends_with',
    '_not_ends_with',
    '_lt',
    '_lte',
    '_gt',
    '_gte',
    '_some',
    '_none',
    '_single',
    '_every',
    '_distance',
    '_distance_lt',
    '_distance_lte',
    '_distance_gt',
    '_distance_gte'
  ];

  let filterType = '';

  if (fieldNameParts.length > 1) {
    let regExp = [];

    _.each(filterTypes, f => {
      regExp.push(f + '$');
    });

    const regExpJoin = '(' + regExp.join('|') + ')';
    const preparedFieldAndFilterField = _.replace(
      fieldName,
      new RegExp(regExpJoin),
      '[::filterFieldSeperator::]$1'
    );
    const [parsedField, parsedFilterField] = preparedFieldAndFilterField.split(
      '[::filterFieldSeperator::]'
    );

    fieldName = !_.isUndefined(parsedField) ? parsedField : fieldName;
    filterType = !_.isUndefined(parsedFilterField)
      ? parsedFilterField.substr(1)
      : ''; // Strip off first underscore
  }

  return {
    name: fieldName,
    type: filterType
  };
};

export const translateScalarFilter = ({
  typeName,
  isListFilterArgument,
  isListFieldFilter,
  filterOperationField,
  filterOperationType,
  filterValue,
  fieldName,
  paramValue,
  variableName,
  parameterPath,
  parentParamPath,
  filterParam,
  nullFieldPredicate
}) => {
  // build path to node/relationship property
  const propertyPath = `${safeVar(variableName)}.${filterOperationField}`;
  if (isExistentialFilter(filterOperationType, filterValue)) {
    return translateNullFilter({
      filterOperationField,
      filterOperationType,
      propertyPath,
      filterParam,
      parentParamPath,
      isListFilterArgument
    });
  }
  if (isListFieldFilter) {
    return translateListArgument({
      typeName,
      filterValue: paramValue[fieldName],
      filterOperationType,
      listVariable: propertyPath,
      paramPath: parameterPath
    });
  }
  return `${nullFieldPredicate}${buildOperatorExpression({
    filterOperationType,
    propertyPath
  })} ${parameterPath}`;
};

export const isExistentialFilter = (type, value) =>
  (!type || type === 'not') && value === null;

export const decideNullSkippingPredicate = ({
  parameterPath,
  isListFilterArgument,
  parentParamPath
}) =>
  isListFilterArgument && parentParamPath ? `${parameterPath} IS NULL OR ` : '';

export const translateNullFilter = ({
  filterOperationField,
  filterOperationType,
  filterParam,
  propertyPath,
  parentParamPath,
  isListFilterArgument
}) => {
  const isNegationFilter = filterOperationType === 'not';
  // allign with modified parameter names for null filters
  const paramPath = `${
    parentParamPath ? parentParamPath : filterParam
  }._${filterOperationField}_${isNegationFilter ? `not_` : ''}null`;
  // build a predicate for checking the existence of a
  // property or relationship
  const predicate = `${paramPath} = TRUE AND${
    isNegationFilter ? '' : ' NOT'
  } EXISTS(${propertyPath})`;
  // skip the field if it is null in the case of it
  // existing within one of many objects in a list filter
  const nullFieldPredicate = decideNullSkippingPredicate({
    parameterPath: paramPath,
    isListFilterArgument,
    parentParamPath
  });
  return `${nullFieldPredicate}${predicate}`;
};

export const buildOperatorExpression = ({
  filterOperationType,
  propertyPath,
  isListFilterArgument,
  parameterPath
}) => {
  if (isListFilterArgument) return `${propertyPath} =`;
  switch (filterOperationType) {
    case 'not':
      return `NOT ${propertyPath} = `;
    case 'in':
      return `${propertyPath} IN`;
    case 'not_in':
      return `NOT ${propertyPath} IN`;
    case 'contains':
      return `${propertyPath} CONTAINS`;
    case 'not_contains':
      return `NOT ${propertyPath} CONTAINS`;
    case 'starts_with':
      return `${propertyPath} STARTS WITH`;
    case 'not_starts_with':
      return `NOT ${propertyPath} STARTS WITH`;
    case 'ends_with':
      return `${propertyPath} ENDS WITH`;
    case 'not_ends_with':
      return `NOT ${propertyPath} ENDS WITH`;
    case 'distance':
      return `distance(${propertyPath}, point(${parameterPath}.point)) =`;
    case 'lt':
      return `${propertyPath} <`;
    case 'distance_lt':
      return `distance(${propertyPath}, point(${parameterPath}.point)) <`;
    case 'lte':
      return `${propertyPath} <=`;
    case 'distance_lte':
      return `distance(${propertyPath}, point(${parameterPath}.point)) <=`;
    case 'gt':
      return `${propertyPath} >`;
    case 'distance_gt':
      return `distance(${propertyPath}, point(${parameterPath}.point)) >`;
    case 'gte':
      return `${propertyPath} >=`;
    case 'distance_gte':
      return `distance(${propertyPath}, point(${parameterPath}.point)) >=`;
    default: {
      return `${propertyPath} =`;
    }
  }
};

export const translateInputFilter = ({
  rootIsRelationType,
  isListFilterArgument,
  isListFieldFilter,
  filterOperationField,
  filterOperationType,
  filterValue,
  paramValue,
  variableName,
  fieldName,
  filterParam,
  schema,
  schemaType,
  parameterPath,
  nullFieldPredicate,
  parentSchemaType,
  parentParamPath,
  parentFieldName
}) => {
  if (fieldName === 'AND' || fieldName === 'OR') {
    return translateLogicalFilter({
      filterValue,
      variableName,
      filterOperationType,
      filterOperationField,
      fieldName,
      filterParam,
      schema,
      schemaType,
      parameterPath,
      nullFieldPredicate
    });
  } else {
    const schemaTypeField = schemaType.getFields()[filterOperationField];
    const innerSchemaType = innerType(schemaTypeField.type);
    const typeName = innerSchemaType.name;
    const isObjectTypeFilter = isObjectType(innerSchemaType);
    const isInterfaceTypeFilter = isInterfaceType(innerSchemaType);
    if (isObjectTypeFilter || isInterfaceTypeFilter) {
      const [
        thisType,
        relatedType,
        relationLabel,
        relationDirection,
        isRelation,
        isRelationType,
        isRelationTypeNode,
        isReflexiveRelationType,
        isReflexiveTypeDirectedField
      ] = decideRelationFilterMetadata({
        fieldName,
        parentSchemaType,
        schemaType,
        variableName,
        innerSchemaType,
        filterOperationField
      });
      if (
        isTemporalType(typeName) ||
        isSpatialType(typeName) ||
        isSpatialDistanceInputType({
          filterOperationType
        })
      ) {
        return translateNeo4jTypeFilter({
          typeName,
          isRelationTypeNode,
          filterValue,
          paramValue,
          variableName,
          filterOperationField,
          filterOperationType,
          fieldName,
          filterParam,
          parameterPath,
          parentParamPath,
          isListFilterArgument,
          isListFieldFilter,
          nullFieldPredicate
        });
      } else if (isRelation || isRelationType || isRelationTypeNode) {
        const filterTranslation = translateRelationFilter({
          rootIsRelationType,
          thisType,
          relatedType,
          relationLabel,
          relationDirection,
          isRelationType,
          isRelationTypeNode,
          isReflexiveRelationType,
          isReflexiveTypeDirectedField,
          filterValue,
          variableName,
          filterOperationField,
          filterOperationType,
          fieldName,
          filterParam,
          schema,
          schemaType,
          innerSchemaType,
          parameterPath,
          parentParamPath,
          isListFilterArgument,
          nullFieldPredicate,
          parentSchemaType,
          parentFieldName
        });
        return filterTranslation;
      }
    }
  }
};

export const translateLogicalFilter = ({
  filterValue,
  variableName,
  filterOperationType,
  filterOperationField,
  fieldName,
  filterParam,
  schema,
  schemaType,
  parameterPath,
  nullFieldPredicate
}) => {
  const listElementVariable = `_${fieldName}`;
  // build predicate expressions for all unique arguments within filterValue
  // isListFilterArgument is true here so that nullFieldPredicate is used
  const predicates = buildFilterPredicates({
    filterOperationType,
    parentFieldName: fieldName,
    listVariable: listElementVariable,
    parentSchemaType: schemaType,
    isListFilterArgument: true,
    schemaType,
    variableName,
    filterValue,
    filterParam,
    // typeFields,
    schema
  });
  const predicateListVariable = parameterPath;
  // decide root predicate function
  const rootPredicateFunction = decidePredicateFunction({
    filterOperationField
  });
  // build root predicate expression
  const translation = buildPredicateFunction({
    nullFieldPredicate,
    predicateListVariable,
    rootPredicateFunction,
    predicates,
    listElementVariable
  });
  return translation;
};

export const translateRelationFilter = ({
  rootIsRelationType,
  thisType,
  relatedType,
  relationLabel,
  relationDirection,
  isRelationType,
  isRelationTypeNode,
  isReflexiveRelationType,
  isReflexiveTypeDirectedField,
  filterValue,
  variableName,
  filterOperationField,
  filterOperationType,
  fieldName,
  filterParam,
  schema,
  schemaType,
  innerSchemaType,
  parameterPath,
  parentParamPath,
  isListFilterArgument,
  nullFieldPredicate,
  parentSchemaType,
  parentFieldName
}) => {
  if (isReflexiveTypeDirectedField) {
    // when at the 'from' or 'to' fields of a reflexive relation type payload
    // we need to use the name of the parent schema type, ex: 'person' for
    // Person.knows gets used here for reflexive path patterns, rather than
    // the normally set 'person_filter_person' variableName
    variableName = parentSchemaType.name.toLowerCase();
  }
  const pathExistencePredicate = buildRelationExistencePath(
    variableName,
    relationLabel,
    relationDirection,
    relatedType,
    isRelationTypeNode
  );
  if (isExistentialFilter(filterOperationType, filterValue)) {
    return translateNullFilter({
      filterOperationField,
      filterOperationType,
      propertyPath: pathExistencePredicate,
      filterParam,
      parentParamPath,
      isListFilterArgument
    });
  }
  let parentFilterOperationField = filterOperationField;
  let parentFilterOperationType = filterOperationType;
  if (isReflexiveTypeDirectedField) {
    // causes the 'from' and 'to' fields on the payload of a reflexive
    // relation type to use the parent field name, ex: 'knows_some'
    // is used for 'from' and 'to' in 'knows_some: { from: {}, to: {} }'
    const parsedFilterName = parseFilterArgumentName(parentFieldName);
    parentFilterOperationField = parsedFilterName.name;
    parentFilterOperationType = parsedFilterName.type;
  }
  // build a list comprehension containing path pattern for related type
  const predicateListVariable = buildRelatedTypeListComprehension({
    rootIsRelationType,
    variableName,
    thisType,
    relatedType,
    relationLabel,
    relationDirection,
    isRelationTypeNode,
    isRelationType
  });

  const rootPredicateFunction = decidePredicateFunction({
    isRelationTypeNode,
    filterOperationField: parentFilterOperationField,
    filterOperationType: parentFilterOperationType
  });

  return buildRelationPredicate({
    rootIsRelationType,
    parentFieldName,
    isRelationType,
    isListFilterArgument,
    isReflexiveRelationType,
    isReflexiveTypeDirectedField,
    thisType,
    relatedType,
    schemaType,
    innerSchemaType,
    fieldName,
    filterOperationType,
    filterValue,
    filterParam,
    schema,
    parameterPath,
    nullFieldPredicate,
    pathExistencePredicate,
    predicateListVariable,
    rootPredicateFunction
  });
};

export const decideRelationFilterMetadata = ({
  fieldName,
  parentSchemaType,
  schemaType,
  variableName,
  innerSchemaType,
  filterOperationField
}) => {
  let thisType = '';
  let relatedType = '';
  let isRelation = false;
  let isRelationType = false;
  let isRelationTypeNode = false;
  let isReflexiveRelationType = false;
  let isReflexiveTypeDirectedField = false;
  // @relation field directive
  let { name: relLabel, direction: relDirection } = relationDirective(
    schemaType,
    filterOperationField
  );
  // @relation type directive on node type field
  const innerRelationTypeDirective = getRelationTypeDirective(
    innerSchemaType.astNode
  );
  // @relation type directive on this type; node type field on relation type
  // If there is no @relation directive on the schemaType, check the parentSchemaType
  // for the same directive obtained above when the relation type is first seen
  const relationTypeDirective = getRelationTypeDirective(schemaType.astNode);
  if (relLabel && relDirection) {
    isRelation = true;
    const typeVariables = typeIdentifiers(innerSchemaType);
    thisType = schemaType.name;
    relatedType = typeVariables.typeName;
  } else if (innerRelationTypeDirective) {
    isRelationType = true;
    thisType = innerRelationTypeDirective.from;
    relatedType = innerRelationTypeDirective.to;
    relLabel = innerRelationTypeDirective.name;
    relDirection = 'OUT';
    if (thisType === relatedType) {
      isReflexiveRelationType = true;
      const isReflexiveOutputType = isReflexiveRelationshipOutputType({
        schemaType
      });
      const directedNodeFieldNames = schemaType.astNode.fields.map(
        field => field.name.value
      );
      const fromFieldName = directedNodeFieldNames[0];
      const toFieldName = directedNodeFieldNames[1];
      if (
        fieldName === 'from' ||
        (isReflexiveOutputType && fieldName === fromFieldName)
      ) {
        isReflexiveTypeDirectedField = true;
        relDirection = 'IN';
      } else if (
        fieldName === 'to' ||
        (isReflexiveOutputType && fieldName === toFieldName)
      ) {
        isReflexiveTypeDirectedField = true;
      }
    } else if (thisType !== relatedType) {
      const filteredType = schemaType && schemaType.name ? schemaType.name : '';
      if (filteredType === relatedType) {
        // then a filter argument for the incoming direction is being used
        // when querying the node type it goes out from
        const temp = thisType;
        thisType = relatedType;
        relatedType = temp;
        relDirection = 'IN';
      }
    }
  } else if (relationTypeDirective) {
    isRelationTypeNode = true;
    thisType = relationTypeDirective.from;
    relatedType = relationTypeDirective.to;
    relLabel = variableName;
    relDirection = 'OUT';
    // if not a reflexive relationship type
    if (thisType !== relatedType) {
      // When buildFilterPredicates is used in buildRelationPredicate,
      // parentSchemaType is provided and used here to decide whether
      // to filter the incoming or outgoing node type
      const filteredType =
        parentSchemaType && parentSchemaType.name ? parentSchemaType.name : '';
      // the connecting node type field on a relationship type filter
      // may be incoming or outgoing; thisType could be .from or .to
      if (filteredType === relatedType) {
        // then this filter argument is being used on a field of the node type
        // the relationship goes .to, so we need to filter for the node types
        // it comes .from
        const temp = thisType;
        thisType = relatedType;
        relatedType = temp;
        relDirection = 'IN';
      }
    }
  }
  return [
    thisType,
    relatedType,
    relLabel,
    relDirection,
    isRelation,
    isRelationType,
    isRelationTypeNode,
    isReflexiveRelationType,
    isReflexiveTypeDirectedField
  ];
};

export const buildRelationPredicate = ({
  rootIsRelationType,
  isRelationType,
  isReflexiveRelationType,
  isReflexiveTypeDirectedField,
  thisType,
  isListFilterArgument,
  relatedType,
  schemaType,
  innerSchemaType,
  fieldName,
  filterOperationType,
  filterValue,
  filterParam,
  schema,
  parameterPath,
  nullFieldPredicate,
  pathExistencePredicate,
  predicateListVariable,
  rootPredicateFunction
}) => {
  let isRelationList =
    filterOperationType === 'in' || filterOperationType === 'not_in';
  let relationVariable = buildRelationVariable(thisType, relatedType);
  let variableName = relatedType.toLowerCase();
  let listVariable = parameterPath;
  if (rootIsRelationType || isRelationType) {
    // change the variable to be used in filtering
    // to the appropriate relationship variable
    // ex: project -> person_filter_project
    variableName = relationVariable;
  }
  if (isRelationList) {
    // set the base list comprehension variable
    // to point at each array element instead
    // ex: $filter.company_in -> _company_in
    listVariable = `_${fieldName}`;
    // set to list to enable null field
    // skipping for all child filters
    isListFilterArgument = true;
  }
  let predicates = buildFilterPredicates({
    parentFieldName: fieldName,
    parentSchemaType: schemaType,
    schemaType: innerSchemaType,
    variableName,
    isListFilterArgument,
    listVariable,
    filterOperationType,
    isRelationType,
    filterValue,
    filterParam,
    schema
  });
  if (isRelationList) {
    predicates = buildPredicateFunction({
      predicateListVariable: parameterPath,
      listElementVariable: listVariable,
      rootPredicateFunction,
      predicates
    });
    rootPredicateFunction = decidePredicateFunction({
      isRelationList
    });
  }
  if (isReflexiveRelationType && !isReflexiveTypeDirectedField) {
    // At reflexive relation type fields, sufficient predicates and values are already
    // obtained from the above call to the recursive buildFilterPredicates
    // ex: Person.knows, Person.knows_in, etc.
    // Note: Since only the internal 'from' and 'to' fields are translated for reflexive
    // relation types, their translations will use the fieldName and schema type name
    // of this field. See: the top of translateRelationFilter
    return predicates;
  }
  const listElementVariable = safeVar(variableName);
  return buildPredicateFunction({
    nullFieldPredicate,
    pathExistencePredicate,
    predicateListVariable,
    rootPredicateFunction,
    predicates,
    listElementVariable
  });
};

export const buildPredicateFunction = ({
  nullFieldPredicate,
  pathExistencePredicate,
  predicateListVariable,
  rootPredicateFunction,
  predicates,
  listElementVariable
}) => {
  // https://neo4j.com/docs/cypher-manual/current/functions/predicate/
  return `${nullFieldPredicate || ''}${
    pathExistencePredicate ? `EXISTS(${pathExistencePredicate}) AND ` : ''
  }${rootPredicateFunction}(${listElementVariable} IN ${predicateListVariable} WHERE ${predicates})`;
};

export const buildRelationVariable = (thisType, relatedType) => {
  return `${thisType.toLowerCase()}_filter_${relatedType.toLowerCase()}`;
};

export const decidePredicateFunction = ({
  filterOperationField,
  filterOperationType,
  isRelationTypeNode,
  isRelationList
}) => {
  if (filterOperationField === 'AND') return 'ALL';
  else if (filterOperationField === 'OR') return 'ANY';
  else if (isRelationTypeNode) return 'ALL';
  else if (isRelationList) return 'ALL';
  else {
    switch (filterOperationType) {
      case 'not':
        return 'NONE';
      case 'in':
        return 'ANY';
      case 'not_in':
        return 'NONE';
      case 'some':
        return 'ANY';
      case 'every':
        return 'ALL';
      case 'none':
        return 'NONE';
      case 'single':
        return 'SINGLE';
      case 'distance':
      case 'distance_lt':
      case 'distance_lte':
      case 'distance_gt':
      case 'distance_gte':
        return 'distance';
      default:
        return 'ALL';
    }
  }
};

export const buildRelatedTypeListComprehension = ({
  rootIsRelationType,
  variableName,
  thisType,
  relatedType,
  relationLabel,
  relationDirection,
  isRelationTypeNode,
  isRelationType
}) => {
  let relationVariable = buildRelationVariable(thisType, relatedType);
  if (rootIsRelationType) {
    relationVariable = variableName;
  }
  const thisTypeVariable =
    !rootIsRelationType && !isRelationTypeNode
      ? safeVar(lowFirstLetter(variableName))
      : safeVar(lowFirstLetter(thisType));
  // prevents related node variable from
  // conflicting with parent variables
  const relatedTypeVariable = safeVar(`_${relatedType.toLowerCase()}`);
  // builds a path pattern within a list comprehension
  // that extracts related nodes
  return `[(${thisTypeVariable})${relationDirection === 'IN' ? '<' : ''}-[${
    isRelationType
      ? safeVar(`_${relationVariable}`)
      : isRelationTypeNode
      ? safeVar(relationVariable)
      : ''
  }${!isRelationTypeNode ? `:${relationLabel}` : ''}]-${
    relationDirection === 'OUT' ? '>' : ''
  }(${isRelationType ? '' : relatedTypeVariable}:${relatedType}) | ${
    isRelationType ? safeVar(`_${relationVariable}`) : relatedTypeVariable
  }]`;
};

export const buildRelationExistencePath = (
  fromVar,
  relLabel,
  relDirection,
  toType,
  isRelationTypeNode
) => {
  // because ALL(n IN [] WHERE n) currently returns true
  // an existence predicate is added to make sure a relationship exists
  // otherwise a node returns when it has 0 such relationships, since the
  // predicate function then evaluates an empty list
  const safeFromVar = safeVar(fromVar);
  return !isRelationTypeNode
    ? `(${safeFromVar})${relDirection === 'IN' ? '<' : ''}-[:${relLabel}]-${
        relDirection === 'OUT' ? '>' : ''
      }(:${toType})`
    : '';
};

export const buildFilterPredicates = ({
  parentSchemaType,
  parentFieldName,
  schemaType,
  variableName,
  listVariable,
  filterValue,
  filterParam,
  schema,
  isListFilterArgument
}) => {
  const predicates = Object.entries(filterValue)
    .reduce((predicates, [name, value]) => {
      name = deserializeFilterFieldName(name);
      const predicate = translateFilterArgument({
        parentParamPath: listVariable,
        fieldName: name,
        filterValue: value,
        paramValue: filterValue,
        parentFieldName,
        parentSchemaType,
        isListFilterArgument,
        variableName,
        filterParam,
        schemaType,
        schema
      });
      if (predicate) {
        predicates.push(`(${predicate})`);
      }
      return predicates;
    }, [])
    .join(' AND ');
  return predicates;
};

export const decideNeo4jTypeFilter = ({ filterOperationType, typeName }) => {
  let cypherTypeConstructor = '';
  let isTemporalFilter = false;
  let isSpatialFilter = false;
  if (
    !isSpatialDistanceInputType({
      filterOperationType
    })
  ) {
    switch (typeName) {
      case '_Neo4jTime': {
        isTemporalFilter = true;
        cypherTypeConstructor = 'time';
        break;
      }
      case '_Neo4jDate': {
        isTemporalFilter = true;
        cypherTypeConstructor = 'date';
        break;
      }
      case '_Neo4jDateTime': {
        isTemporalFilter = true;
        cypherTypeConstructor = 'datetime';
        break;
      }
      case '_Neo4jLocalTime': {
        isTemporalFilter = true;
        cypherTypeConstructor = 'localtime';
        break;
      }
      case '_Neo4jLocalDateTime': {
        isTemporalFilter = true;
        cypherTypeConstructor = 'localdatetime';
        break;
      }
      case '_Neo4jPoint': {
        isSpatialFilter = true;
        cypherTypeConstructor = 'point';
        break;
      }
    }
  }
  return [isTemporalFilter, isSpatialFilter, cypherTypeConstructor];
};

export const translateNeo4jTypeFilter = ({
  typeName,
  isRelationTypeNode,
  filterValue,
  paramValue,
  variableName,
  filterOperationField,
  filterOperationType,
  fieldName,
  filterParam,
  parameterPath,
  parentParamPath,
  isListFilterArgument,
  isListFieldFilter,
  nullFieldPredicate
}) => {
  const safeVariableName = safeVar(variableName);
  let propertyPath = `${safeVariableName}.${filterOperationField}`;
  const [
    isTemporalFilter,
    isSpatialFilter,
    cypherTypeConstructor
  ] = decideNeo4jTypeFilter({
    filterOperationType,
    typeName
  });
  if (isExistentialFilter(filterOperationType, filterValue)) {
    return translateNullFilter({
      filterOperationField,
      filterOperationType,
      propertyPath,
      filterParam,
      parentParamPath,
      isListFilterArgument
    });
  }
  if (isListFieldFilter) {
    return translateListArgument({
      typeName,
      filterValue: paramValue[fieldName],
      filterOperationType,
      listVariable: propertyPath,
      paramPath: parameterPath,
      isNeo4jType: true
    });
  }
  const rootPredicateFunction = decidePredicateFunction({
    isRelationTypeNode,
    filterOperationField,
    filterOperationType
  });
  return buildNeo4jTypePredicate({
    fieldName,
    filterOperationField,
    filterOperationType,
    filterValue,
    parameterPath,
    variableName,
    nullFieldPredicate,
    rootPredicateFunction,
    cypherTypeConstructor,
    parentIsListArgument: isListFilterArgument,
    isTemporalFilter,
    isSpatialFilter
  });
};

export const buildNeo4jTypeTranslation = ({
  filterOperationType,
  listVariable,
  isTemporalFilter,
  isSpatialFilter,
  parentIsListArgument,
  isListFilterArgument,
  filterValue,
  nullFieldPredicate,
  propertyPath,
  cypherTypeConstructor,
  operatorExpression,
  parameterPath,
  rootPredicateFunction
}) => {
  if (
    isSpatialDistanceInputType({
      filterOperationType
    })
  ) {
    listVariable = `${listVariable}.distance`;
  }
  let translation = '';
  const isIdentityFilter =
    !filterOperationType || filterOperationType === 'not';
  if (
    (isTemporalFilter || isSpatialFilter) &&
    (isIdentityFilter || isListFilterArgument || parentIsListArgument)
  ) {
    const generalizedComparisonPredicates = Object.keys(filterValue).map(
      filterName => {
        const isTemporalFormatted =
          isTemporalFilter && filterName === 'formatted';
        if (nullFieldPredicate || isListFilterArgument) {
          nullFieldPredicate = `${listVariable}.${filterName} IS NULL OR `;
        }
        if (isTemporalFormatted) {
          return `(${nullFieldPredicate}${propertyPath} = ${cypherTypeConstructor}(${listVariable}.${filterName}))`;
        } else {
          return `(${nullFieldPredicate}${propertyPath}.${filterName} = ${listVariable}.${filterName})`;
        }
      }
    );
    translation = `(${generalizedComparisonPredicates.join(' AND ')})`;
    if (filterOperationType === 'not') {
      translation = `NOT${translation}`;
    }
  } else {
    translation = `(${nullFieldPredicate}${operatorExpression} ${cypherTypeConstructor}(${listVariable}))`;
  }
  if (isListFilterArgument) {
    translation = buildPredicateFunction({
      predicateListVariable: parameterPath,
      listElementVariable: listVariable,
      rootPredicateFunction,
      predicates: translation
    });
  }
  return translation;
};

export const buildNeo4jTypePredicate = ({
  fieldName,
  filterOperationField,
  filterOperationType,
  filterValue,
  parameterPath,
  variableName,
  nullFieldPredicate,
  rootPredicateFunction,
  cypherTypeConstructor,
  parentIsListArgument,
  isTemporalFilter,
  isSpatialFilter
}) => {
  const isListFilterArgument =
    filterOperationType === 'in' || filterOperationType === 'not_in';
  // ex: project -> person_filter_project
  let listVariable = parameterPath;
  // ex: $filter.datetime_in -> _datetime_in
  if (isListFilterArgument) listVariable = `_${fieldName}`;
  const safeVariableName = safeVar(variableName);
  let propertyPath = `${safeVariableName}.${filterOperationField}`;
  const operatorExpression = buildOperatorExpression({
    filterOperationType,
    propertyPath,
    isListFilterArgument,
    parameterPath
  });
  const translation = buildNeo4jTypeTranslation({
    filterOperationType,
    listVariable,
    isTemporalFilter,
    isSpatialFilter,
    parentIsListArgument,
    isListFilterArgument,
    filterValue,
    nullFieldPredicate,
    propertyPath,
    cypherTypeConstructor,
    operatorExpression,
    parameterPath,
    rootPredicateFunction
  });
  return translation;
};

export const translateListArgument = ({
  typeName,
  filterValue,
  filterOperationType,
  isNeo4jType,
  listVariable,
  paramPath
}) => {
  const parameterPath = 'value';
  const propertyPath = 'prop';
  let whereClause = '';
  let translation = '';
  if (filterValue.length) {
    // When a list is evaludated as a predicate, an empty list is false
    // So we use list comprehensions to filter list properties
    if (isNeo4jType) {
      // The deeper scope of custom neo4j temporal and spatial types
      // require another layer of iteration
      whereClause = translateCustomTypeListArgument({
        typeName,
        filterValue,
        filterOperationType
      });
      if (filterOperationType) {
        if (filterOperationType === 'not') {
          const propertyList = cypherList({
            variable: propertyPath,
            listVariable
          });
          whereClause = `[${propertyList} WHERE ${whereClause}]`;
        } else {
          whereClause = cypherList({
            variable: propertyPath,
            listVariable,
            whereClause
          });
        }
      } else {
        whereClause = cypherList({
          variable: propertyPath,
          listVariable,
          whereClause
        });
      }
      if (filterOperationType === 'not') {
        const parameterList = cypherList({
          listVariable: paramPath
        });
        translation = `NONE(${parameterList} WHERE ${whereClause})`;
      } else {
        translation = cypherList({ listVariable: paramPath, whereClause });
      }
    } else {
      if (filterOperationType) {
        let innerOperation = filterOperationType;
        // negated list filters are wrapped with NONE rather
        // than using NOT on the list comprehension predicate
        if (innerOperation === 'not') innerOperation = '';
        const operatorExpression = buildOperatorExpression({
          filterOperationType: innerOperation,
          propertyPath,
          parameterPath
        });
        whereClause = `${operatorExpression} ${parameterPath}`;
        whereClause = cypherList({
          variable: propertyPath,
          listVariable,
          whereClause
        });
      } else {
        whereClause = cypherList({ listVariable });
      }
      if (filterOperationType === 'not') {
        const propertyList = cypherList({ listVariable: paramPath });
        translation = `NONE(${propertyList} WHERE ${whereClause})`;
      } else {
        translation = cypherList({ listVariable: paramPath, whereClause });
      }
    }
  } else {
    let sizeOperator = `=`;
    if (filterOperationType === 'not') sizeOperator = `>`;
    translation = `(size(${listVariable}) ${sizeOperator} 0)`;
  }
  return translation;
};

export const translateCustomTypeListArgument = ({
  typeName,
  variable = 'value',
  propertyVariable = 'prop',
  filterValue = [],
  filterOperationType = ''
}) => {
  let translation = '';
  if (isSpatialDistanceInputType({ filterOperationType })) {
    // exception to ignore the inner fields of the distance filter input type
    const operatorExpression = buildOperatorExpression({
      filterOperationType,
      propertyPath: propertyVariable,
      parameterPath: variable
    });
    translation = `(${operatorExpression}${variable}.distance)`;
  } else {
    // map all unique inner field selections of the given custom property type
    const uniqueFilterMap = filterValue.reduce((booleanMap, filter) => {
      Object.keys(filter).forEach(key => {
        booleanMap[key] = true;
      });
      return booleanMap;
    }, {});
    // Builds a single predicate used for comparing a list of a custom type (DateTime, etc.)
    // to a matching list property containing values of that type.
    translation = Object.keys(uniqueFilterMap)
      .map(filterName => {
        const isTemporalFormatted = filterName === 'formatted';
        // short-circuit evaluate to let differences in selected fields pass through
        const nullFieldPredicate = `${variable}.${filterName} IS NULL OR `;
        let propertyPath = '';
        // the path to the argument value of to compare against, e.g. value.year, value.x
        let parameterPath = `${variable}.${filterName}`;
        if (isTemporalFormatted) {
          propertyPath = `${propertyVariable}`;
          let typeConstructor = decideNeo4jTypeConstructor(typeName);
          if (!typeConstructor) {
            // list filter arguments pass the type definition corresponding to
            // generated input types, _Neo4jDateTime vs _Neo4jDateTimeInput
            // further generalization of constructor selection can clean this up
            const [
              isTemporalFilter,
              isSpatialFilter,
              cypherTypeConstructor
            ] = decideNeo4jTypeFilter({
              filterOperationType,
              typeName
            });
            typeConstructor = cypherTypeConstructor;
          }
          if (typeConstructor) {
            parameterPath = `${typeConstructor}(${parameterPath})`;
          }
        } else {
          // the path to an inner field of the matching property
          // being compared, e.g. prop.year, prop.x
          propertyPath = `${propertyVariable}.${filterName}`;
        }
        if (filterOperationType === 'not') filterOperationType = '';
        // builds the left hand side of the comparison predicate for list filters
        const operatorExpression = buildOperatorExpression({
          filterOperationType,
          propertyPath,
          parameterPath
        });
        // default comparison operator is =
        return `(${nullFieldPredicate}${operatorExpression} ${parameterPath})`;
      })
      .join(' AND ');
  }
  return `(${translation})`;
};

export const cypherList = ({
  variable = 'value',
  listVariable = '',
  whereClause = '',
  filterClause = ''
}) => {
  if (whereClause || filterClause) {
    whereClause = whereClause ? ` WHERE ${whereClause}` : '';
    filterClause = filterClause ? ` ${filterClause}` : '';
    listVariable = `${listVariable}${whereClause}${filterClause}`;
    return `[${variable} IN ${listVariable}]`;
  }
  return `${variable} IN ${listVariable}`;
};
