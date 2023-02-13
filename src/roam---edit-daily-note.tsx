import { Form, getPreferenceValues, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import RoamPrivateApi from './RoamPrivateApi';

interface Preferences {
  email: string;
  password: string;
  graph: string;
}

let roamApi: RoamPrivateApi;


export default function Command() {
  const { email, password, graph } = getPreferenceValues<Preferences>(); 
  const { pop } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // think about caching
    roamApi = new RoamPrivateApi(graph, email, password, {headless: true, folder: '', nodownload: false});    
  }, [email, password, graph]);
  
  return (
    <Form>
      <Form.TextField
        // title="Block"
        id="name"
        defaultValue={''}
      />
  </Form>
  );
}
