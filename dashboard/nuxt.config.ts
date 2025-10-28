// Nuxt config for SAIA Dashboard
export default defineNuxtConfig({
  ssr: false,
  nitro: {
    preset: 'static',
  },
  modules: ['@nuxt/ui'],
  app: {
    baseURL: '/dashboard/',
    head: { title: 'SAIA Dashboard' }
  },
  typescript: { shim: false },
});

