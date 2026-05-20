/**
 * Lighthouse CI config — fails the build on regressions to the buyer-web budget.
 * See doc/phase-6.md §7 for the table of thresholds.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/search?query=shirt',
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        throttlingMethod: 'simulate',
        skipAudits: ['uses-http2'],
      },
    },
    assert: {
      assertions: {
        'categories:performance':       ['error', { minScore: 0.85 }],
        'categories:accessibility':     ['warn',  { minScore: 0.9 }],
        'categories:best-practices':    ['warn',  { minScore: 0.9 }],
        'first-contentful-paint':       ['error', { maxNumericValue: 1800 }],
        'largest-contentful-paint':     ['error', { maxNumericValue: 2500 }],
        'total-blocking-time':          ['error', { maxNumericValue: 200 }],
        'cumulative-layout-shift':      ['error', { maxNumericValue: 0.05 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 350 * 1024 }],
        'resource-summary:image:size':  ['warn',  { maxNumericValue: 600 * 1024 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
