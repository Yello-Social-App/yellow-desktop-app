Sample data for surfaces the Yello API does not serve yet — communities,
project showcase, stories, feature feedback, and post reports with mute and
block. Each store seeds from here and keeps its mutations in memory for the
session; nothing is sent anywhere. Swap a store's seed for an API call when
the endpoint ships and the screens do not change.

`request.ts` stands in for those endpoints: `sampleRequest` answers after a
short delay so pending states show. Only a feature's `api.ts` calls it, which
is the one file to change when the real endpoint lands.
