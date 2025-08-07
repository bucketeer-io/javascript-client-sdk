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
              
              // Consider all properties (computed, non-computed, methods) as defaults
              if (prop.type === 'Property') {
                hasDefaultProperties = true
              }
              
              // Check for spread elements that might contain defaults
              if (prop.type === 'SpreadElement') {
                if (hasDefaultProperties) {
                  context.report({
                    node: prop,
                    message:
                      'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
                  })
                } else {
                  // Treat this spread element as a potential default for subsequent spreads
                  hasDefaultProperties = true
                }
              }
            }
          },
        }
      },
    },
  },
}
