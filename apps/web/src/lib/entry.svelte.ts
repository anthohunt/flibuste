// A fresh document needs a real gesture; returning to a menu within it does not.
// Never persist this in localStorage: legal acknowledgment is not browser audio permission.
export const entry = $state({ accepted: false });
