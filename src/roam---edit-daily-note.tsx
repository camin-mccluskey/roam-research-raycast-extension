import { Action, ActionPanel, Form, getPreferenceValues, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import RoamPrivateApi from './RoamPrivateApi';

type Preferences = {
  email: string;
  password: string;
  graph: string;
}

// const cache = new Cache();


export default function Command() {
  const { email, password, graph } = getPreferenceValues<Preferences>(); 
  const { pop } = useNavigation();
  const [roamApi, setRoamApi] = useState<RoamPrivateApi | null>(null);
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // possibly reintroduce caching
  // const setCache = (roamApi: RoamPrivateApi) => {
  //   cache.set('roam-api', JSON.stringify({cachedApi: instanceToPlain(roamApi), timestamp: new Date().getTime()}));
  //   console.log('cached roam api');

  // }

  useEffect(() => {
    // if (cache.has('roam-api')) {
    //   console.log('using cached roam api')
    //   const { cachedApi, timestamp } = JSON.parse(cache.get('roam-api') as string) as CachedRoamApi;
    //   if (new Date().getTime() - timestamp > 1000 * 60) {
    //     console.log('cached roam api expired');
    //     cache.remove('roam-api');
    //     setRoamApi(null);
    //   } else {
    //     console.log(cachedApi)
    //     setRoamApi(plainToInstance(RoamPrivateApi, cachedApi));
    //     return;
    //   }
    // }
    console.log('starting login')
    const newRoamApi = new RoamPrivateApi(
      graph, email, password,
      (roamApi: RoamPrivateApi) => console.log('login finished'),
      {headless: true, folder: '', nodownload: false}
    );
    setRoamApi(newRoamApi);
  }, [email, password, graph]);

  const onSubmit = () => {
    if (!roamApi) return;
    setIsLoading(true);
    roamApi.createDailyNoteBlock(title).then((res) => {
      console.log('success');
      console.log(res)
    }).catch((err) => {
      console.log(err);
    }).finally(() => {
      setIsLoading(false);
      pop();
    });
  };
  
  return (
    <Form
      isLoading={isLoading}
      navigationTitle='Create New Block'
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        title="Block Title"
        id="name"
        placeholder="Block Title"
        defaultValue={'Daily Note'}
        onChange={setTitle}
      />
    </Form>
  )
}
