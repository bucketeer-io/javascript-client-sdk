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
                const argName = prop.argument?.name || ''
                
                // Check if this spread element looks like it's spreading defaults
                const isLikelyDefaultSpread = prop.argument && 
                  prop.argument.type === 'Identifier' && 
                  (/^(default|base|initial|fallback)/i.test(argName) ||
                   /(default|base|initial)config$/i.test(argName))
                
                if (isLikelyDefaultSpread) {
                  hasDefaultProperties = true
                } else if (hasDefaultProperties) {
                  context.report({
                    node: prop,
                    message:
                      'Spreading objects after default properties can override defaults with undefined values. Consider using nullish coalescing (??) instead.',
                  })
                }
              }
            }
          },
        }
      },
    },
  },
}
