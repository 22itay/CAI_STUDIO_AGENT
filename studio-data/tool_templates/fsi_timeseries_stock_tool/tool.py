from typing import Type, List
from pydantic import BaseModel, Field
from pydantic import BaseModel as StudioBaseTool
from textwrap import dedent

import json
import yfinance as yf
import pandas as pd


class UserParameters(BaseModel):
    pass

class StockTickerHistoryLookupTool(StudioBaseTool):
    class ToolParameters(BaseModel):
        tickers_list: List[str] = Field(description="List of stock tickers to pull from the web")

    name: str = "Stock Ticker History LookupTool"
    description: str = dedent(
        """Fetch historical price data for multiple stocks over the last year.
        Args:
            tickers_list: List of stock ticker symbols
            
        Returns:
            str: Status of the timeseries lookup of selected stock tickers"""
    )
    args_schema: Type[BaseModel] = ToolParameters
    user_parameters: UserParameters

    

    def _run(self, tickers_list: List[str]) -> str:
        all_time_series = {}
        all_time_series_status = {}
        # Get stock data for each ticker
        for ticker in tickers_list:
            stock = yf.Ticker(ticker)
            hist = stock.history(period="3y")
            # Extract dates and closing prices
            if not hist.empty:
                dates = hist.index.strftime('%Y-%m-%d').tolist()
                prices = hist['Close'].tolist()
                
                # Convert to DataFrame with date as index and prices as columns
                df = pd.DataFrame(prices, index=dates, columns=[ticker])
                
                # Merge with existing DataFrame
                if 'all_time_series_df' in locals():
                    all_time_series_df = all_time_series_df.merge(df, how='outer', left_index=True, right_index=True)
                else:
                    all_time_series_df = df
                all_time_series_status[ticker] = "Data Lookup complete"
            else:
                all_time_series_status[ticker] = "No history found"
        all_time_series_df.index = pd.to_datetime(all_time_series_df.index)
        all_time_series_df.to_csv('/tmp/ts.csv', index=True)
        return  json.dumps(all_time_series_status)


        
