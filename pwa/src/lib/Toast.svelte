<script>
  import { toast } from '../store.js'

  let current = $state(null)
  let timer = null

  toast.subscribe(v => {
    if (timer) clearTimeout(timer)
    current = v
    if (v) {
      timer = setTimeout(() => { current = null; toast.set(null) }, v.duration ?? 4000)
    }
  })

  function dismiss() {
    if (timer) clearTimeout(timer)
    current = null
    toast.set(null)
  }
</script>

{#if current}
  <div class="toast-wrap">
    <div class="toast" role="status">
      <div class="toast-body">{current.message}</div>
      {#if current.action}
        <button class="toast-action" onclick={() => { current.action.fn(); dismiss() }}>
          {current.action.label}
        </button>
      {/if}
      <div
        class="toast-progress"
        style="animation-duration: {current.duration ?? 4000}ms"
      ></div>
    </div>
  </div>
{/if}
