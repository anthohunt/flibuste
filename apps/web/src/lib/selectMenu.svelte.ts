export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectRequest {
 owner: string;
 label: string;
 value: string;
 options: SelectOption[];
 choose: (value: string) => void;
}
// The layer lives beside main, outside transformed tables and clipped panels.
export const selectMenu = $state<{ current: SelectRequest | null }>({current:null});
