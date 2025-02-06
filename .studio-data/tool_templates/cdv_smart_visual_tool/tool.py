import json
from textwrap import dedent
from typing import List, Dict, Optional, Literal, Type
from pydantic import Field, BaseModel
from pydantic import BaseModel as StudioBaseTool
import requests
from urllib.parse import urljoin


class UserParameters(BaseModel):
    cdv_base_url: str
    cml_apiv2_app_key: str

class CDVCreateVisualTool(StudioBaseTool):
    class ToolParameters(BaseModel):
        dataset_id: str = Field(description="The ID of the dataset to be used for creating the visual")
        columns: List[Dict[str, str]] = Field(description="Columns to be used while creating the visual. It is mandatory to provide at least one column. This parameter cannot be an empty list.")
        title: str = Field(description="Title for the new visual to be created")

    name: str = "CDV Create Visual Tool"
    description: str = dedent(
        """
        This function creates a visual in CDV(Cloudera Data Visualization) from a dataset.
        Visual means an actual visualization like a table, chart, etc.

        Each item in the `columns` list should be a dictionary with the following keys:
        - `column_name`: The name of the column to be used in the visual. This is a mandatory field.
        - `aggregate_function`: The aggregate function to be applied to the column. Valid values of aggregate function are: `sum`, `avg`, `min`, `max`, `count`. This is an optional field.

        The function returns the ID & url of the created visual.
        """
    )
    args_schema: Type[BaseModel] = ToolParameters
    user_parameters: UserParameters

    def _run(
        self,
        dataset_id: str,
        columns: List[Dict[str, str]],
        title: str,
    ) -> str:
        """
        This function creates a visual in CDV(Cloudera Data Visualization) from a dataset.
        Visual means an actual visualization like a table, chart, etc.

        Each item in the `columns` list should be a dictionary with the following keys:
        - `column_name`: The name of the column to be used in the visual. This is a mandatory field.
        - `aggregate_function`: The aggregate function to be applied to the column. Valid values of aggregate function are: `sum`, `avg`, `min`, `max`, `count`. This is an optional field.

        The function returns the ID & url of the created visual.
        """

        class ColumnObj(BaseModel):
            column_name: str
            aggregate_function: Optional[Literal["sum", "avg", "min", "max", "count"]] = None

        # Validate columns parameter
        if not columns:
            raise ValueError("`columns` cannot be empty")
        
        # Validate each column using Pydantic
        validated_columns = []
        for col in columns:
            try:
                validated_col = ColumnObj.model_validate(col)
                validated_columns.append(validated_col.model_dump(exclude_none=True))
            except Exception as e:
                raise ValueError(f"Invalid column configuration: {str(e)}")
        columns = validated_columns

        request_headers = {
            "accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"bearer {self.user_parameters.cml_apiv2_app_key}",
        }

        login_path = "arc/apps"
        login_url = urljoin(self.user_parameters.cdv_base_url, login_path)
        session = requests.Session()
        login_response = session.get(login_url, headers=request_headers)
        if login_response.status_code != 200:
            raise Exception(f"Failed to login to CDV: {login_response.text}")


        relative_path = "arc/adminapi/v1/visuals/smart"
        url = urljoin(self.user_parameters.cdv_base_url, relative_path)

        payload = {
            'dataset_id': dataset_id,
            'columns': json.dumps(columns),
            'filters': json.dumps([]),
            'title': title,
        }
        response = session.post(url, headers=request_headers, data=payload)
        if response.status_code != 200:
            raise Exception(f"Failed to create visual: {response.text}")
        return_val: dict = response.json()
        return_val.update({
            "visual_id": return_val["id"],
            "url": urljoin(self.user_parameters.cdv_base_url, f"arc/apps/app/{return_val['id']}"),
        })
        return return_val