<script lang="ts">
  import { ICONS, type IconName } from '../lib/icons';

  let { name, size = 24, class: cls = '', label }: { name: IconName; size?: number; class?: string; label?: string } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  class="inline-block shrink-0 {cls}"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : true}
  data-icon={name}
>
  {@html ICONS[name]}
</svg>
