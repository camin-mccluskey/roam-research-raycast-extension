import { Action, ActionPanel, Form, getPreferenceValues, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import RoamPrivateApi from "./RoamPrivateApi";

type Preferences = {
  email: string;
  password: string;
  graph: string;
};

// const cache = new Cache();

export default function Command() {
  const { email, password, graph } = getPreferenceValues<Preferences>();
  const { pop } = useNavigation();
  const [roamApi, setRoamApi] = useState<RoamPrivateApi | null>(null);
  const [title, setTitle] = useState("loading...");
  const [isLoading, setIsLoading] = useState(false);

  const roamToMD = (input: string[][]): string => {
    let res = "";
    input.forEach((block) => {
      res += `- ${block[0]}\n`;
    });
    return res;
  };

  useEffect(() => {
    setIsLoading(true);
    console.log("starting login");
    const newRoamApi = new RoamPrivateApi(
      graph,
      email,
      password,
      (roamApi: RoamPrivateApi) => console.log("login finished"),
      { headless: true, folder: "", nodownload: false }
    );
    setRoamApi(newRoamApi);
    newRoamApi.getAllBlocksOnDailyNote().then((res) => {
      console.log(res);
      setIsLoading(false);
      setTitle(roamToMD(res));
    });
  }, [email, password, graph]);

  const onSubmit = () => {};

  return (
    <Form
      isLoading={isLoading}
      enableDrafts
      actions={
        <ActionPanel>
          <Action.SubmitForm
            onSubmit={(values: any) => {
              console.log("onSubmit", values);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="dailyNote"
        autoFocus={false}
        enableMarkdown
        value={title}
        onChange={(value) => setTitle(value)}
      />
    </Form>
  );
}
