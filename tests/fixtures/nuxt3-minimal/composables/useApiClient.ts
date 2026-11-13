export function useApiClient() {
  const id = '7'
  const hello = useFetch('/api/hello')
  const user = $fetch(`/api/users/${id}`)
  return { hello, user }
}
