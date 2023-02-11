import { Action, ActionPanel, Form, getPreferenceValues, useNavigation } from "@raycast/api";
import RoamPrivateApi from './RoamPrivateApi';
import { useEffect, useState } from "react";

interface Preferences {
  email: string;
  password: string;
  graph: string;
}

let roamApi: RoamPrivateApi;


export default function Command() {
  const { email, password, graph } = getPreferenceValues<Preferences>(); 
  const { pop } = useNavigation();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // todo - load in puppeteer early so we can achieve some caching (hopefully)
    // exp w/ this - https://developers.raycast.com/utilities/react-hooks/usecachedstate
    roamApi = new RoamPrivateApi(graph, email, password, {headless: true, folder: '', nodownload: false});    
  }, [email, password, graph]);

  const onSubmit = () => {
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
      <Form.TextArea
        title="Block Content"
        id="content"
        placeholder={"Text"}
        defaultValue={''}
        onChange={setContent}
      />
    </Form>
  )
}
