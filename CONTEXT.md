# CyberChefCloud

CyberChefCloud is a fork of GCHQ's CyberChef. Users build recipes in the browser to transform data, and some of the operations in those recipes call Google Cloud services, local AI models or an AI agent.

## Language

### The kitchen (inherited from CyberChef)

CyberChef names its core parts after cooking: a **chef** follows a **recipe**, and each **operation** in it acts on the **dish**, set up by its **ingredients**.

**User**:
The person who builds and runs recipes in CyberChefCloud.
_Avoid_: Analyst, chef

**Chef**:
The part of CyberChef that bakes: it takes the input and a recipe, passes the dish through each operation in turn, and returns the output. There is one chef; it is not a person.
_Avoid_: Engine, runner, executor

**Recipe**:
An ordered list of operations, each with its ingredient values, that the chef follows from top to bottom.
_Avoid_: Pipeline, workflow, chain

**Recipe config**:
The saved form of a recipe (operation names and their ingredient values) that a user can copy, share, put in a URL, or paste into Load recipe.
_Avoid_: Recipe JSON, recipe string

**Operation**:
A single named transformation in a recipe, such as `From Base64` or `GCloud Vision`. It takes the dish in one data type and gives it back in another.
_Avoid_: Ingredient, function, op (in user-facing text), tool (except when the agent is using it)

**Ingredient**:
One configurable value of an operation, such as a dropdown choice, a text box or a checkbox. Each operation defines its ingredients (name, kind, default); the recipe holds the value chosen for each one.
_Avoid_: Using "ingredient" for an operation or for a result

**Argument**:
The same thing as an ingredient. Use "argument" in user-facing text, where CyberChef's help already explains "arguments (or Ingredients)"; use "ingredient" when talking about how CyberChef works.
_Avoid_: Parameter, option, setting

**Dish**:
The data during a bake, together with its data type. The dish starts as the input; each operation takes it and replaces it with its own result; what is left after the last operation becomes the output.
_Avoid_: Payload, buffer, data (when the in-flight value is meant)

**Data type**:
The form the dish is held in: string, byte array, array buffer, number, big number, JSON, HTML, file, or list of files. Each operation states the data type it needs and the one it returns, and the dish converts between them.

**Input**:
The data the user gives the recipe, in the input pane. It becomes the first dish.

**Output**:
The dish after the last operation, as shown in the output pane.

**Presentation**:
A readable form of the final operation's result, made only for the output pane. Operations later in a recipe always receive the raw result, never the presentation.
_Avoid_: Pretty output, display format

**Bake**:
One run of the recipe over the input by the chef. With **auto bake** a bake starts whenever the input or recipe changes; with **manual bake** a bake starts only when the user clicks Bake. Some operations switch auto bake off when they are added to the recipe.
_Avoid_: Run, execute

**Breakpoint**:
A mark on an operation that stops the bake just before that operation, so the user can see the dish at that point.

**Disabled operation**:
An operation left in the recipe but skipped during a bake.

**Flow-control operation**:
An operation that changes the order in which the chef follows the recipe instead of changing the dish, such as `Fork`, `Merge`, `Jump`, `Conditional Jump`, `Label`, `Register`, `Subsection` and `Return`.

**Category**:
A named group of operations in the Operations list, such as `Cloud` or `Local AI`. One operation can be in more than one category.

### Google Cloud

**Cloud operation**:
An operation that calls a Google Cloud service (or another cloud service) and needs credentials from an earlier `Authenticate Google Cloud` operation in the same recipe.
_Avoid_: GCloud op, cloud ingredient

**Credentials**:
The authentication that `Authenticate Google Cloud` sets up and that every later cloud operation in the recipe uses. Credentials are never an ingredient of a cloud operation.
_Avoid_: Auth, key (unless it is specifically an API key)

**Auth type**:
The way the credentials were obtained: an **OAuth sign-in** (Google login popup), an **access token** pasted in, or an **API key**.

**Access token**:
A short-lived Google OAuth token (about one hour), for example from `gcloud auth print-access-token`, pasted into `Authenticate Google Cloud`.
_Avoid_: PAT, personal access token

**Quota project**:
The Google Cloud project that a cloud operation's requests are billed to and counted against.
_Avoid_: Billing project

**GCS URI**:
The `gs://bucket/path` address of an object in Google Cloud Storage. Cloud operations that write to GCS output the GCS URI of what they wrote, so a later operation can read it.
_Avoid_: GCS path, bucket path

**Long-running operation**:
A Google Cloud job that a cloud operation submits and then polls until it finishes, such as a long speech transcription. Always write the full term, or LRO, so it is not confused with a CyberChef operation.

**Cloud Run function**:
A small server-side service that exactly one cloud operation calls, for work the browser cannot do, such as holding a third-party secret.
_Avoid_: Backend, proxy, server

### Local AI

**Local model**:
A language model that runs inside the user's browser, so no data is sent to a cloud service.

**Backend**:
The engine that runs a local model, such as Chrome built-in (Gemini Nano) or GGUF.
_Avoid_: Provider, runtime

**Model store**:
The browser storage that holds the local model files the user has downloaded or imported.

### AI agent

**Agent**:
The language-model loop inside the `AI Agent` operation, which chooses operations and runs them on the input to reach a goal the user describes.

**Tool**:
An operation as the agent sees and calls it.
_Avoid_: Function, action

## Relationships

- The **chef** bakes one **recipe** over the **input**.
- A **recipe** is an ordered list of **operations**; each operation in it carries a value for each of its **ingredients**.
- During a **bake** there is one **dish**. Each **operation** receives the dish in the **data type** it needs and replaces it with its result.
- After the last operation the dish is the **output**; that operation may also give a **presentation** of it for the output pane.
- A **flow-control operation** changes which operation the chef runs next; `Fork` splits the dish into parts and runs the following operations (up to a `Merge`) once per part, and `Merge` joins the results.
- A **cloud operation** reads the **credentials** set by an earlier `Authenticate Google Cloud` operation in the same recipe.
- The **agent** inside `AI Agent` treats operations as **tools**. It can return the steps it took as a **recipe config**, or the dish those steps produced (its recipe output).
