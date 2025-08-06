export default {
  rules: {
    'no-spread-after-defaults': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow spreading objects after default properties in object literals',
          category: 'Possible Errors',
          recommended: false,
        },
        schema: [],
      },
      create(context) {
        return {
          ObjectExpression(node) {
            const properties = node.properties
            let hasDefaultProperties = false
            for (let i = 0; i < properties.length; i++) {
              const prop = properties[i]
              if (prop.type === 'Property' && !prop.computed) {
                hasDefaultProperties = true
              }
              if (
                prop.type === 'SpreadElement' &&
                hasDefaultProperties &&
                prop.argument.type === 'Identifier' // Only flag spreading variables/identifiers
              ) {
                context.report({
                  node: prop,
                  message:
                    'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
                })
              }
            }
          },
        }
      },
    },
  },
}
