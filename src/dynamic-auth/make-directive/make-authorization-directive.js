import { DirectiveLocation, GraphQLString } from 'graphql';
import { has } from 'ramda';
import { typeIdentifiers } from '../../utils';

export const AUTHORIZATION_NAME = 'authz';
export const AUTHORIZATION_DIRECTIVE = {
  customParams: [
    {
      name: 'this',
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ],
  instances: [],
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.INTERFACE,
    DirectiveLocation.OBJECT,
    DirectiveLocation.UNION
  ],
  params: [
    {
      name: 'requires',
      type: {
        defaultValue: 'FALSE',
        getType: () => GraphQLString,
        required: true,
        value: 'String!'
      },
      wrappers: [
        { left: '"', right: '"' },
        { left: '"""', right: '"""' }
      ]
    }
  ]
};

const toAuthorization = requires => variableName =>
  `(${requires.replace(new RegExp('this', 'g'), variableName)})`;

const saveNodeAuthorization = ({ authorizations, requires, typeName }) => {
  if (!has(typeName, authorizations)) {
    authorizations[typeName] = {
      fields: {},
      node: []
    };
  }
  authorizations[typeName].node.push(toAuthorization(requires));
};

export const makeAuthorizationDirective = (
  name,
  args,
  { authorizations = {} }
) => ({
  visitFieldDefinition(field, details) {
    const parentName = details.objectType.name;
    const { name: fieldName } = field;
    const { typeName } = typeIdentifiers(field.type);
    if (!has(typeName, authorizations)) {
      authorizations[typeName] = {
        fields: {},
        node: []
      };
    }
    if (!has(fieldName, authorizations[typeName].fields)) {
      authorizations[typeName].fields[fieldName] = {};
    }
    if (!has(parentName, authorizations[typeName].fields[fieldName])) {
      authorizations[typeName].fields[fieldName][parentName] = [];
    }
    authorizations[typeName].fields[fieldName][parentName].push(
      toAuthorization(args.requires || this.args.requires)
    );
  },
  visitInterface({ name: typeName }) {
    saveNodeAuthorization({
      authorizations,
      requires: args.requires || this.args.requires,
      typeName
    });
  },
  visitObject({ name: typeName }) {
    saveNodeAuthorization({
      authorizations,
      requires: args.requires || this.args.requires,
      typeName
    });
  },
  visitUnion({ name: typeName }) {
    saveNodeAuthorization({
      authorizations,
      requires: args.requires || this.args.requires,
      typeName
    });
  }
});
