export default defineNuxtConfig({
  ssr: true,
  routeRules: {
    '/blog/**': { swr: 3600 },
    '/admin/**': { ssr: false },
    '/old': { redirect: '/new' },
    '/about': { prerender: true },
  },
})
