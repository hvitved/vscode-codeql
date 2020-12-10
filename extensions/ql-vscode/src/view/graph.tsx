import * as React from 'react';
import * as d3 from 'd3';
import { ResultTableProps } from './result-table-utils';
import { InterpretedResultSet, GraphInterpretationData } from '../pure/interface-types';
import { graphviz } from 'd3-graphviz';
import { jumpToLocation } from './result-table-utils';
import { tryGetLocationFromString } from '../pure/bqrs-utils';
export type GraphProps = ResultTableProps & { resultSet: InterpretedResultSet<GraphInterpretationData> };

const className = 'vscode-codeql__result-tables-graph';

export class Graph extends React.Component<GraphProps> {
  constructor(props: GraphProps) {
    super(props);
  }

  public render = (): JSX.Element => {
    return <div id={className} className={className} />;
  };

  public componentDidMount = () => {
    this.renderGraph();
  };

  public componentDidUpdate = () => {
    this.renderGraph();
  };

  private renderGraph = () => {
    const { databaseUri, resultSet } = this.props;
    const options = {
      fit: true,
      fade: false,
      growEnteringEdges: false,
      zoom: true,
    };

    graphviz(`#${className}`)
      .options(options)
      .attributer(function(d) {
        if (d.tag == 'a') {
          const url = d.attributes['xlink:href'] || d.attributes['href'];
          console.log(url);
          alert(url);
          const loc = tryGetLocationFromString(url);
          if (loc !== undefined) {
            d.attributes['xlink:href'] = '#';
            d.attributes['href'] = '#';
            loc.uri = 'file://' + loc.uri;
            d3.select(this).on('click', function(e) { jumpToLocation(loc, databaseUri); });
          }
        }
      })
      .renderDot(resultSet.interpretation.data.dot);
  };
}
