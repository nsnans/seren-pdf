/* Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Namespace } from "./namespace";
import { NamespaceIds } from "./namespaces";
import { StringObject, XFAAttributesObj, XFAObject, XFAObjectArray } from "./xfa_object";

const CONNECTION_SET_NS_ID = NamespaceIds.connectionSet.id;

class ConnectionSet extends XFAObject {

  protected wsdlConnection = new XFAObjectArray();

  protected xmlConnection = new XFAObjectArray();

  protected xsdConnection = new XFAObjectArray();

  constructor() {
    super(CONNECTION_SET_NS_ID, "connectionSet", /* hasChildren = */ true);
  }
}

class EffectiveInputPolicy extends XFAObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "effectiveInputPolicy");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class EffectiveOutputPolicy extends XFAObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "effectiveOutputPolicy");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class Operation extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "operation");
    this.id = attributes.id || "";
    this.input = attributes.input || "";
    this.name = attributes.name || "";
    this.output = attributes.output || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class RootElement extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "rootElement");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class SoapAction extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "soapAction");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class SoapAddress extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "soapAddress");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class Uri extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "uri");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class WsdlAddress extends StringObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "wsdlAddress");
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.use = attributes.use || "";
    this.usehref = attributes.usehref || "";
  }
}

class WsdlConnection extends XFAObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "wsdlConnection", /* hasChildren = */ true);
    this.dataDescription = attributes.dataDescription || "";
    this.name = attributes.name || "";
    this.effectiveInputPolicy = null;
    this.effectiveOutputPolicy = null;
    this.operation = null;
    this.soapAction = null;
    this.soapAddress = null;
    this.wsdlAddress = null;
  }
}

class XmlConnection extends XFAObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "xmlConnection", /* hasChildren = */ true);
    this.dataDescription = attributes.dataDescription || "";
    this.name = attributes.name || "";
    this.uri = null;
  }
}

class XsdConnection extends XFAObject {
  constructor(attributes:XFAAttributesObj) {
    super(CONNECTION_SET_NS_ID, "xsdConnection", /* hasChildren = */ true);
    this.dataDescription = attributes.dataDescription || "";
    this.name = attributes.name || "";
    this.rootElement = null;
    this.uri = null;
  }
}

class ConnectionSetNamespace implements Namespace {

  public static readonly DEFAULT = new ConnectionSetNamespace();

  protected constructor() { }

  buildXFAObject(name: string, attributes: XFAAttributesObj) {
    if (this.hasOwnProperty(name)) {
      return (this as any)[name](attributes);
    }
    return undefined;
  }

  connectionSet(attrs: XFAAttributesObj){
    return new ConnectionSet(attrs);
  }

  effectiveInputPolicy(attrs: XFAAttributesObj){
    return new EffectiveInputPolicy(attrs);
  }

  effectiveOutputPolicy(attrs: XFAAttributesObj){
    return new EffectiveOutputPolicy(attrs);
  }

  operation(attrs: XFAAttributesObj){
    return new Operation(attrs);
  }

  rootElement(attrs: XFAAttributesObj){
    return new RootElement(attrs);
  }

  soapAction(attrs: XFAAttributesObj){
    return new SoapAction(attrs);
  }

  soapAddress(attrs: XFAAttributesObj){
    return new SoapAddress(attrs);
  }

  uri(attrs: XFAAttributesObj){
    return new Uri(attrs);
  }

  wsdlAddress(attrs: XFAAttributesObj){
    return new WsdlAddress(attrs);
  }

  wsdlConnection(attrs: XFAAttributesObj){
    return new WsdlConnection(attrs);
  }

  xmlConnection(attrs: XFAAttributesObj){
    return new XmlConnection(attrs);
  }

  xsdConnection(attrs: XFAAttributesObj){
    return new XsdConnection(attrs);
  }
}

export { ConnectionSetNamespace };
