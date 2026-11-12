<script setup>
definePageMeta({ middleware: ['auth'], layout: 'default' })
const route = useRoute()
const { data } = await useFetch('/api/hello')
</script>
<template>
  <div>User {{ route.params.id }} — {{ data }}</div>
</template>
